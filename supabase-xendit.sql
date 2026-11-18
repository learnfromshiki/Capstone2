-- ============================================================================
-- CONNECT-Daet.ph - online payments through Xendit (replaces PayMongo)
--
-- Run in Supabase -> SQL Editor AFTER supabase-live-badges-reset.sql.
-- Safe to run again.
--
-- How it fits together:
--   1. place_order() creates the orders with payment_method = 'xendit' and
--      payment_status = 'unpaid' (set_initial_payment_status).
--   2. /api/xendit/checkout opens a Xendit Payment Session (hosted payment
--      link) for the whole checkout and stores its id on every order of it.
--   3. Xendit calls /api/xendit/webhook when the session is completed or
--      expires, and the return page double-checks the session. The server
--      then calls xendit_mark_checkout_paid() or xendit_session_expired().
--      Only the service role can call those two; customers and sellers can
--      never mark an order paid themselves.
--   4. An online order cannot be confirmed, packed or shipped until it is
--      paid, and an unpaid one is cancelled when its payment link expires,
--      so its stock and any reward points spent on it are released.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. The session column (no order ever used PayMongo, so it is renamed)
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'shop_orders' and column_name = 'paymongo_session_id'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'shop_orders' and column_name = 'xendit_session_id'
  ) then
    alter table public.shop_orders rename column paymongo_session_id to xendit_session_id;
  end if;
end;
$$;

alter table public.shop_orders add column if not exists xendit_session_id text;
alter table public.shop_orders drop column if exists paymongo_session_id;

drop index if exists public.shop_orders_paymongo_session_idx;
create index if not exists shop_orders_xendit_session_idx on public.shop_orders (xendit_session_id);

-- ----------------------------------------------------------------------------
-- 2. 'xendit' replaces 'paymongo' as the online payment method
-- ----------------------------------------------------------------------------
update public.shop_orders set payment_method = 'xendit' where payment_method = 'paymongo';

alter table public.shop_orders drop constraint if exists shop_orders_payment_method_check;
alter table public.shop_orders
  add constraint shop_orders_payment_method_check
  check (payment_method in ('gcash', 'cod', 'bank', 'xendit'));

create or replace function public.set_initial_payment_status()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.payment_method = 'xendit' then
    new.payment_status := 'unpaid';
    new.paid_at := null;
    new.xendit_session_id := null;
  end if;
  return new;
end;
$$;

-- place_order(): accept 'xendit' instead of 'paymongo' (the method check and
-- the minimum online amount). Patched in place so the rest stays identical.
do $$
declare
  v_def text := pg_get_functiondef(
    'public.place_order(jsonb, text, text, text, text, text, text, text, text, text, integer)'::regprocedure
  );
begin
  if position('''paymongo''' in v_def) > 0 then
    execute replace(v_def, '''paymongo''', '''xendit''');
  end if;
end;
$$;

-- Customers and sellers cannot change the order or payment columns.
create or replace function public.protect_order_customer_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  new.user_id := old.user_id;
  new.seller_id := old.seller_id;
  new.checkout_id := old.checkout_id;
  new.customer_name := old.customer_name;
  new.customer_email := old.customer_email;
  new.customer_phone := old.customer_phone;
  new.delivery_address := old.delivery_address;
  new.payment_method := old.payment_method;
  new.total_amount := old.total_amount;
  new.shipping_fee := old.shipping_fee;
  new.notes := old.notes;
  new.payment_status := old.payment_status;
  new.xendit_session_id := old.xendit_session_id;
  new.paid_at := old.paid_at;
  new.fulfillment_method := old.fulfillment_method;
  new.points_redeemed := old.points_redeemed;
  new.points_discount := old.points_discount;

  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. An online order is not prepared before it is paid
-- ----------------------------------------------------------------------------
create or replace function public.update_order_status(p_order_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_order record;
  v_is_admin boolean := public.is_admin();
  v_status text := lower(trim(coalesce(p_status, '')));
  v_allowed text[];
  v_restored integer := 0;
  v_foreign_items boolean;
begin
  if v_user is null then
    raise exception 'Please sign in again.' using errcode = '28000';
  end if;

  if v_status not in ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled') then
    raise exception 'Unknown order status.' using errcode = '22023';
  end if;

  select id, status, user_id, payment_method, payment_status into v_order
  from shop_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;

  if not v_is_admin then
    if not public.seller_can_sell() or not public.seller_owns_order(p_order_id) then
      raise exception 'You can only update orders that contain your products.' using errcode = '42501';
    end if;

    select exists (
      select 1
      from shop_order_items oi
      left join shop_products p on p.id = oi.product_id
      where oi.order_id = p_order_id
        and p.seller_id is distinct from public.current_seller_id()
    ) into v_foreign_items;

    if v_foreign_items and v_status = 'cancelled' then
      raise exception 'This order also contains items from other shops. Please ask the CONNECT-Daet admin to cancel it.'
        using errcode = '42501';
    end if;
  end if;

  if v_order.status = v_status then
    return jsonb_build_object('status', v_status, 'restored_items', 0);
  end if;

  -- Paid online: nothing is packed or sent until the money has arrived.
  if v_order.payment_method = 'xendit'
     and v_order.payment_status is distinct from 'paid'
     and v_status not in ('pending', 'cancelled') then
    raise exception 'This order is paid online and the payment has not arrived yet. Wait until it shows "Paid online" before preparing it.'
      using errcode = 'P0001';
  end if;

  v_allowed := case v_order.status
    when 'pending' then array['confirmed', 'processing', 'cancelled']
    when 'confirmed' then array['processing', 'shipped', 'cancelled']
    when 'processing' then array['shipped', 'cancelled']
    when 'shipped' then array['delivered']
    else array[]::text[]
  end;

  if not (v_status = any(v_allowed)) then
    if v_order.status = 'cancelled' then
      raise exception 'A cancelled order cannot be reopened. Create a new order instead.' using errcode = 'P0001';
    elsif v_order.status = 'delivered' then
      raise exception 'A delivered order cannot be changed.' using errcode = 'P0001';
    end if;
    raise exception 'An order cannot move from % to %.', v_order.status, v_status using errcode = 'P0001';
  end if;

  if v_status = 'cancelled' then
    v_restored := public._cancel_order_internal(p_order_id);
  else
    update shop_orders
    set status = v_status,
        updated_at = now()
    where id = p_order_id;
  end if;

  return jsonb_build_object('status', v_status, 'restored_items', v_restored);
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Called by the server (service role) when Xendit reports a payment
-- ----------------------------------------------------------------------------
/**
 * Mark every order of a checkout paid. Matching the session id as well as
 * the checkout id means a payment only ever settles the orders it was opened
 * for. Running it twice is harmless.
 *
 * Each shop is told the order is paid and can be prepared. If an order was
 * cancelled while the customer was paying, the admin is told to refund it.
 */
create or replace function public.xendit_mark_checkout_paid(
  p_checkout_id uuid,
  p_session_id text,
  p_payment_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order record;
  v_paid integer := 0;
  v_refunds integer := 0;
begin
  if p_checkout_id is null or coalesce(p_session_id, '') = '' then
    return jsonb_build_object('paid', 0, 'refunds_needed', 0);
  end if;

  for v_order in
    update shop_orders o
    set payment_status = 'paid',
        paid_at = now(),
        payment_reference = left(coalesce(nullif(p_payment_id, ''), p_session_id), 120),
        updated_at = now()
    where o.checkout_id = p_checkout_id
      and o.xendit_session_id = p_session_id
      and o.payment_method = 'xendit'
      and o.payment_status is distinct from 'paid'
    returning o.id, o.status, o.seller_id, o.total_amount, o.customer_name
  loop
    v_paid := v_paid + 1;

    if v_order.status = 'cancelled' then
      v_refunds := v_refunds + 1;
      perform public.push_admin_notification(
        'order',
        'Refund needed',
        'Order #' || upper(left(v_order.id::text, 8)) || ' was paid online (PHP '
          || to_char(coalesce(v_order.total_amount, 0), 'FM999G999G990D00')
          || ') after it was cancelled. Refund the customer in Xendit.',
        '/shop/admin?tab=orders'
      );
    else
      perform public.push_notification(
        (select s.user_id from shop_sellers s where s.id = v_order.seller_id),
        'seller',
        'order',
        'Order paid online',
        coalesce(nullif(btrim(v_order.customer_name), ''), 'A customer') || ' paid for order #'
          || upper(left(v_order.id::text, 8)) || '. You can prepare it now.',
        '/shop/seller/dashboard?tab=orders&order=' || v_order.id::text
      );
    end if;
  end loop;

  return jsonb_build_object('paid', v_paid, 'refunds_needed', v_refunds);
end;
$$;

/**
 * The payment link expired without a payment: cancel the orders that are
 * still waiting for it, which puts their stock back on sale and returns any
 * reward points spent on them. Only the session that expired counts, so an
 * older link expiring never touches an order paid through a newer one.
 */
create or replace function public.xendit_session_expired(
  p_checkout_id uuid,
  p_session_id text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order uuid;
  v_cancelled integer := 0;
begin
  if p_checkout_id is null or coalesce(p_session_id, '') = '' then
    return 0;
  end if;

  for v_order in
    select o.id
    from shop_orders o
    where o.checkout_id = p_checkout_id
      and o.xendit_session_id = p_session_id
      and o.payment_method = 'xendit'
      and o.payment_status = 'unpaid'
      and o.status = 'pending'
    order by o.id
    for update
  loop
    update shop_orders set payment_status = 'failed', updated_at = now() where id = v_order;
    perform public._cancel_order_internal(v_order);
    v_cancelled := v_cancelled + 1;
  end loop;

  return v_cancelled;
end;
$$;

revoke all on function public.xendit_mark_checkout_paid(uuid, text, text) from public, anon, authenticated;
revoke all on function public.xendit_session_expired(uuid, text) from public, anon, authenticated;
grant execute on function public.xendit_mark_checkout_paid(uuid, text, text) to service_role;
grant execute on function public.xendit_session_expired(uuid, text) to service_role;

commit;
