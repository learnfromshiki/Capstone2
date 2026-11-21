-- ============================================================================
-- Audit fixes, refunds & returns, review replies & moderation (2026-11-22)
--
--   Fixes
--     * a cancelled order gives its voucher use back
--     * shop earnings are counted after the shop's own voucher
--     * cancelling an order that was already paid online alerts the admin
--   Refunds & returns
--     * shop_orders.delivered_at (return window starts here)
--     * shop_return_requests + request_return(), respond_return(),
--       mark_order_refunded()
--   Reviews
--     * shop_reviews.seller_reply / seller_reply_at / is_hidden
--     * reply_to_review(), moderate_review(); hidden reviews leave the
--       public listing
--
-- Needs supabase-shopee-features.sql first. Safe to run more than once.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- When an order was delivered
-- ---------------------------------------------------------------------------
alter table shop_orders add column if not exists delivered_at timestamptz;

update shop_orders set delivered_at = coalesce(delivered_at, updated_at)
where status = 'delivered' and delivered_at is null;

create or replace function public.stamp_delivered_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' then
    new.delivered_at := coalesce(new.delivered_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists stamp_delivered_at on shop_orders;
create trigger stamp_delivered_at
  before update of status on shop_orders
  for each row execute function public.stamp_delivered_at();

-- ---------------------------------------------------------------------------
-- Cancelling: give the voucher use back, and flag paid orders for a refund
-- ---------------------------------------------------------------------------
create or replace function public._cancel_order_internal(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order record;
  v_restored integer;
begin
  select id, user_id, seller_id, voucher_code, payment_status, total_amount, status
  into v_order
  from shop_orders where id = p_order_id;

  -- Lock the product rows in a fixed order, then put the units back once.
  perform 1
  from shop_products p
  where p.id in (select product_id from shop_order_items where order_id = p_order_id)
  order by p.id
  for update;

  update shop_products p
  set stock = coalesce(p.stock, 0) + i.quantity,
      updated_at = now()
  from (
    select product_id, sum(quantity)::integer as quantity
    from shop_order_items
    where order_id = p_order_id and product_id is not null
    group by product_id
  ) i
  where p.id = i.product_id;

  get diagnostics v_restored = row_count;

  perform public._revoke_order_points(v_order.user_id, p_order_id);

  -- The voucher can be used again.
  if v_order.voucher_code is not null and v_order.status is distinct from 'cancelled' then
    perform set_config('app.voucher_redemption', 'true', true);
    update shop_vouchers
    set used_count = greatest(used_count - 1, 0)
    where seller_id = v_order.seller_id and code = v_order.voucher_code;
    perform set_config('app.voucher_redemption', 'false', true);
  end if;

  update shop_orders
  set status = 'cancelled',
      updated_at = now()
  where id = p_order_id;

  -- Money already received for it has to go back to the customer.
  if v_order.payment_status = 'paid' then
    perform public.push_admin_notification(
      'refund',
      'Refund needed',
      'Order ' || upper(left(p_order_id::text, 8)) || ' was cancelled after it was paid (PHP ' ||
        to_char(v_order.total_amount, 'FM999,999,990.00') || '). Refund the customer, then mark it refunded.',
      '/shop/admin?tab=orders&order=' || p_order_id
    );
  end if;

  return v_restored;
end;
$$;

-- ---------------------------------------------------------------------------
-- Shop earnings after the shop's own voucher
-- ---------------------------------------------------------------------------
create or replace function public.create_seller_earnings()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_seller_id uuid;
  v_commission_rate numeric(5,2);
  v_sale_amount numeric(10,2);
  v_commission numeric(10,2);
  v_earning numeric(10,2);
  v_voucher numeric(12,2);
  v_items_total numeric(12,2);
begin
  select p.seller_id, s.commission_rate into v_seller_id, v_commission_rate
  from shop_products p
  left join shop_sellers s on p.seller_id = s.id
  where p.id = new.product_id;

  if v_seller_id is null then
    return new;
  end if;

  v_sale_amount := new.price * new.quantity;

  -- A shop voucher is paid for by the shop: spread it over the order's items.
  select coalesce(o.voucher_discount, 0),
         coalesce(o.total_amount, 0) - coalesce(o.shipping_fee, 0)
           + coalesce(o.points_discount, 0) + coalesce(o.voucher_discount, 0)
  into v_voucher, v_items_total
  from shop_orders o where o.id = new.order_id;

  if coalesce(v_voucher, 0) > 0 and coalesce(v_items_total, 0) > 0 then
    v_sale_amount := round(v_sale_amount * (1 - v_voucher / v_items_total), 2);
  end if;

  v_commission := v_sale_amount * (coalesce(v_commission_rate, 0) / 100);
  v_earning := v_sale_amount - v_commission;

  insert into shop_seller_earnings (
    seller_id, order_id, order_item_id, product_sale_amount, commission_amount, seller_earning, status
  ) values (
    v_seller_id, new.order_id, new.id, v_sale_amount, v_commission, v_earning, 'pending'
  );

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Refunds & returns
-- ---------------------------------------------------------------------------
create table if not exists shop_return_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references shop_orders(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  seller_id uuid references shop_sellers(id) on delete set null,
  kind text not null check (kind in ('return', 'cancel_refund')),
  reason text not null,
  details text,
  photos jsonb not null default '[]'::jsonb,
  status text not null default 'requested' check (status in ('requested', 'approved', 'declined', 'refunded')),
  response_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- One open request per order.
create unique index if not exists shop_return_requests_one_open
  on shop_return_requests (order_id) where status in ('requested', 'approved');

alter table shop_return_requests enable row level security;

drop policy if exists "Returns are visible to the people involved" on shop_return_requests;
create policy "Returns are visible to the people involved" on shop_return_requests
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or (seller_id is not null and seller_id = public.current_seller_id())
  );

grant select on shop_return_requests to authenticated;

-- The customer asks: a return within 7 days of delivery, or a cancel and
-- refund for an order paid online that has not shipped yet.
create or replace function public.request_return(
  p_order_id uuid,
  p_reason text,
  p_details text default null,
  p_photos jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_order record;
  v_kind text;
  v_reason text := left(btrim(coalesce(p_reason, '')), 200);
  v_details text := nullif(left(btrim(coalesce(p_details, '')), 1000), '');
  v_photos jsonb := coalesce(p_photos, '[]'::jsonb);
  v_id uuid;
  v_seller_user uuid;
begin
  if v_user is null then
    raise exception 'Please sign in again.' using errcode = '28000';
  end if;

  if v_reason = '' then
    raise exception 'Please choose a reason.' using errcode = '22023';
  end if;

  if jsonb_typeof(v_photos) <> 'array' or jsonb_array_length(v_photos) > 5 then
    raise exception 'Attach up to 5 photos.' using errcode = '22023';
  end if;

  select id, user_id, seller_id, status, payment_status, delivered_at, customer_name
  into v_order
  from shop_orders where id = p_order_id for update;

  if not found or v_order.user_id is distinct from v_user then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;

  if v_order.status = 'delivered' then
    if v_order.delivered_at is not null and v_order.delivered_at < now() - interval '7 days' then
      raise exception 'Returns can be requested within 7 days of delivery. Please message the shop.'
        using errcode = 'P0001';
    end if;
    v_kind := 'return';
  elsif v_order.payment_status = 'paid' and v_order.status in ('pending', 'confirmed', 'processing') then
    v_kind := 'cancel_refund';
  else
    raise exception 'This order cannot be returned or refunded online. Please message the shop.'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1 from shop_return_requests
    where order_id = p_order_id and status in ('requested', 'approved')
  ) then
    raise exception 'You already have an open request for this order.' using errcode = 'P0001';
  end if;

  insert into shop_return_requests (order_id, user_id, seller_id, kind, reason, details, photos)
  values (p_order_id, v_user, v_order.seller_id, v_kind, v_reason, v_details, v_photos)
  returning id into v_id;

  select user_id into v_seller_user from shop_sellers where id = v_order.seller_id;

  perform public.push_notification(
    v_seller_user, 'seller', 'order',
    case v_kind when 'return' then 'Return requested' else 'Cancel & refund requested' end,
    coalesce(nullif(btrim(v_order.customer_name), ''), 'A customer') || ': ' || v_reason,
    '/shop/seller/dashboard?tab=orders&order=' || p_order_id
  );
  perform public.push_admin_notification(
    'refund',
    case v_kind when 'return' then 'Return requested' else 'Cancel & refund requested' end,
    'Order ' || upper(left(p_order_id::text, 8)) || ': ' || v_reason,
    '/shop/admin?tab=orders&order=' || p_order_id
  );

  return v_id;
end;
$$;

revoke all on function public.request_return(uuid, text, text, jsonb) from public;
grant execute on function public.request_return(uuid, text, text, jsonb) to authenticated;

-- The shop (or the admin) approves or declines. Approving a cancel & refund
-- cancels the order right away (stock, points and voucher go back); the money
-- itself is sent back and then confirmed with mark_order_refunded().
create or replace function public.respond_return(p_request_id uuid, p_approve boolean, p_note text default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request record;
  v_order record;
  v_status text;
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
begin
  if auth.uid() is null then
    raise exception 'Please sign in again.' using errcode = '28000';
  end if;

  select * into v_request from shop_return_requests where id = p_request_id for update;
  if not found then
    raise exception 'Request not found.' using errcode = 'P0002';
  end if;

  if not public.is_admin() and not public.seller_owns_order(v_request.order_id) then
    raise exception 'Request not found.' using errcode = 'P0002';
  end if;

  if v_request.status <> 'requested' then
    raise exception 'This request was already answered.' using errcode = 'P0001';
  end if;

  if not p_approve and v_note is null then
    raise exception 'Please tell the customer why the request is declined.' using errcode = '22023';
  end if;

  v_status := case when p_approve then 'approved' else 'declined' end;

  update shop_return_requests
  set status = v_status,
      response_note = v_note,
      updated_at = now(),
      resolved_at = case when p_approve then null else now() end
  where id = p_request_id;

  if p_approve and v_request.kind = 'cancel_refund' then
    select status into v_order from shop_orders where id = v_request.order_id for update;
    if v_order.status <> 'cancelled' then
      perform set_config('app.trusted_order_update', 'true', true);
      update shop_orders set cancel_reason = 'Refund approved: ' || v_request.reason where id = v_request.order_id;
      perform set_config('app.trusted_order_update', 'false', true);
      perform public._cancel_order_internal(v_request.order_id);
    end if;
  end if;

  perform public.push_notification(
    v_request.user_id, 'customer', 'order',
    case
      when not p_approve then 'Your request was declined'
      when v_request.kind = 'return' then 'Your return was approved'
      else 'Your refund was approved'
    end,
    coalesce(
      v_note,
      case
        when v_request.kind = 'return' then 'The shop will message you about sending the item back.'
        else 'The order is cancelled and your money will be returned.'
      end
    ),
    '/shop/buyer?tab=orders&order=' || v_request.order_id
  );

  return v_status;
end;
$$;

revoke all on function public.respond_return(uuid, boolean, text) from public;
grant execute on function public.respond_return(uuid, boolean, text) to authenticated;

-- The money went back: by the admin for online payments (Xendit pays the
-- platform), by the shop or the admin for cash, GCash or bank.
create or replace function public.mark_order_refunded(p_order_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order record;
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
  v_is_admin boolean := public.is_admin();
begin
  if auth.uid() is null then
    raise exception 'Please sign in again.' using errcode = '28000';
  end if;

  select id, user_id, status, payment_method, payment_status, total_amount
  into v_order from shop_orders where id = p_order_id for update;

  if not found or (not v_is_admin and not public.seller_owns_order(p_order_id)) then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;

  if v_order.payment_status = 'refunded' then
    return;
  end if;

  if v_order.payment_method = 'xendit' and not v_is_admin then
    raise exception 'Online payments are refunded by the CONNECT-Daet admin.' using errcode = '42501';
  end if;

  -- Only something that was approved, or an order cancelled after payment.
  if not (
    v_order.status = 'cancelled'
    or exists (
      select 1 from shop_return_requests
      where order_id = p_order_id and status = 'approved'
    )
  ) then
    raise exception 'Approve the return first.' using errcode = 'P0001';
  end if;

  perform set_config('app.trusted_order_update', 'true', true);
  update shop_orders set payment_status = 'refunded', updated_at = now() where id = p_order_id;
  perform set_config('app.trusted_order_update', 'false', true);

  update shop_return_requests
  set status = 'refunded', updated_at = now(), resolved_at = now(),
      response_note = coalesce(v_note, response_note)
  where order_id = p_order_id and status = 'approved';

  -- A returned delivery: the shop is not paid for it and the points go back.
  update shop_seller_earnings set status = 'cancelled' where order_id = p_order_id and status <> 'cancelled';
  if v_order.status = 'delivered' then
    perform public._revoke_order_points(v_order.user_id, p_order_id);
  end if;

  perform public.push_notification(
    v_order.user_id, 'customer', 'order',
    'Refund sent',
    'PHP ' || to_char(v_order.total_amount, 'FM999,999,990.00') || ' for order ' ||
      upper(left(p_order_id::text, 8)) || ' was refunded.' || coalesce(' ' || v_note, ''),
    '/shop/buyer?tab=orders&order=' || p_order_id
  );
end;
$$;

revoke all on function public.mark_order_refunded(uuid, text) from public;
grant execute on function public.mark_order_refunded(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Reviews: shop replies and admin moderation
-- ---------------------------------------------------------------------------
alter table shop_reviews add column if not exists seller_reply text;
alter table shop_reviews add column if not exists seller_reply_at timestamptz;
alter table shop_reviews add column if not exists is_hidden boolean not null default false;

-- Hidden reviews leave the public listing; the writer, the shop and the
-- admin still see them.
drop policy if exists shop_reviews_select_public on shop_reviews;
create policy shop_reviews_select_public on shop_reviews
  for select to anon, authenticated
  using (
    not is_hidden
    or user_id = auth.uid()
    or public.is_admin()
    or public.seller_owns_product(product_id)
  );

create or replace function public.reply_to_review(p_review_id uuid, p_reply text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_review record;
  v_reply text := nullif(left(btrim(coalesce(p_reply, '')), 1000), '');
  v_product text;
begin
  if auth.uid() is null then
    raise exception 'Please sign in again.' using errcode = '28000';
  end if;

  select id, product_id, user_id into v_review from shop_reviews where id = p_review_id for update;
  if not found or not (public.seller_owns_product(v_review.product_id) or public.is_admin()) then
    raise exception 'Review not found.' using errcode = 'P0002';
  end if;

  update shop_reviews
  set seller_reply = v_reply,
      seller_reply_at = case when v_reply is null then null else now() end
  where id = p_review_id;

  if v_reply is not null then
    select name into v_product from shop_products where id = v_review.product_id;
    perform public.push_notification(
      v_review.user_id, 'customer', 'review',
      'The shop replied to your review',
      coalesce(v_product || ': ', '') || v_reply,
      '/shop?product=' || v_review.product_id
    );
  end if;
end;
$$;

revoke all on function public.reply_to_review(uuid, text) from public;
grant execute on function public.reply_to_review(uuid, text) to authenticated;

create or replace function public.moderate_review(p_review_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Only the admin can moderate reviews.' using errcode = '42501';
  end if;

  if p_action = 'hide' then
    update shop_reviews set is_hidden = true where id = p_review_id;
  elsif p_action = 'show' then
    update shop_reviews set is_hidden = false where id = p_review_id;
  elsif p_action = 'delete' then
    delete from shop_reviews where id = p_review_id;
  else
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.moderate_review(uuid, text) from public;
grant execute on function public.moderate_review(uuid, text) to authenticated;

commit;
