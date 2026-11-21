-- ============================================================================
-- Audit fixes for supabase-shopee-features.sql and supabase-returns-reviews.sql
-- (2026-11-22). Safe to run more than once.
--
--   1. Signed-out visitors may not call the new order/review functions, and
--      nobody may call trigger functions directly. (Supabase grants EXECUTE
--      on new functions to anon by default; "revoke from public" does not
--      undo that.)
--   2. "X sold" counts only real sales: no unpaid online orders, no refunds.
--   3. A shop can mark refunded only money it actually received.
--   4. Return photos must be https links.
--   5. Performance advisor: auth.uid() evaluated once per query in the new
--      policies, indexes for the new foreign keys, one SELECT policy on
--      vouchers, pinned search_path on stamp_delivered_at.
-- ============================================================================

begin;

-- 1. Who may call what -------------------------------------------------------
revoke execute on function public.place_order(jsonb, text, text, text, text, text, text, text, text, text, integer, jsonb) from anon;
revoke execute on function public.cancel_my_order(uuid, text) from anon;
revoke execute on function public.set_order_tracking(uuid, text, text) from anon;
revoke execute on function public.request_return(uuid, text, text, jsonb) from anon;
revoke execute on function public.respond_return(uuid, boolean, text) from anon;
revoke execute on function public.mark_order_refunded(uuid, text) from anon;
revoke execute on function public.reply_to_review(uuid, text) from anon;
revoke execute on function public.moderate_review(uuid, text) from anon;

-- Trigger functions run from their triggers; no one calls them directly.
revoke execute on function public.notify_followers_new_product() from public, anon, authenticated;
revoke execute on function public.protect_voucher_usage() from public, anon, authenticated;
revoke execute on function public.stamp_delivered_at() from public, anon, authenticated;

-- 2. "X sold" ----------------------------------------------------------------
create or replace function public.product_sold_counts()
returns table (product_id uuid, sold bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select i.product_id, sum(i.quantity)::bigint
  from shop_order_items i
  join shop_orders o on o.id = i.order_id
  where i.product_id is not null
    and o.status <> 'cancelled'
    and o.payment_status is distinct from 'refunded'
    and not (o.payment_method = 'xendit' and o.payment_status is distinct from 'paid')
  group by i.product_id;
$$;

-- 3. Refunds only for money that was received --------------------------------
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

  -- Either an approved return/refund request, or an order that was paid and
  -- then cancelled. An unpaid cancelled order has nothing to give back.
  -- coalesce: cash/GCash/bank orders have no payment_status (NULL), and a
  -- NULL here would make the whole check "unknown" and let it through.
  if not (
    (v_order.status = 'cancelled' and coalesce(v_order.payment_status, '') = 'paid')
    or exists (
      select 1 from shop_return_requests
      where order_id = p_order_id and status = 'approved'
    )
  ) then
    raise exception 'There is no payment to refund on this order, or the return is not approved yet.'
      using errcode = 'P0001';
  end if;

  perform set_config('app.trusted_order_update', 'true', true);
  update shop_orders set payment_status = 'refunded', updated_at = now() where id = p_order_id;
  perform set_config('app.trusted_order_update', 'false', true);

  update shop_return_requests
  set status = 'refunded', updated_at = now(), resolved_at = now(),
      response_note = coalesce(v_note, response_note)
  where order_id = p_order_id and status = 'approved';

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

revoke all on function public.mark_order_refunded(uuid, text) from public, anon;
grant execute on function public.mark_order_refunded(uuid, text) to authenticated;

-- 4. Return photos are https links -------------------------------------------
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

  if jsonb_typeof(v_photos) <> 'array' or jsonb_array_length(v_photos) > 5
     or exists (
       select 1 from jsonb_array_elements(v_photos) p
       where jsonb_typeof(p) <> 'string'
          or length(p #>> '{}') > 500
          or (p #>> '{}') !~ '^https://[^\s"<>]+$'
     ) then
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

revoke all on function public.request_return(uuid, text, text, jsonb) from public, anon;
grant execute on function public.request_return(uuid, text, text, jsonb) to authenticated;

-- 5. Performance advisor -----------------------------------------------------
create or replace function public.stamp_delivered_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' then
    new.delivered_at := coalesce(new.delivered_at, now());
  end if;
  return new;
end;
$$;
revoke execute on function public.stamp_delivered_at() from public, anon, authenticated;

create index if not exists shop_return_requests_user on shop_return_requests (user_id);
create index if not exists shop_return_requests_seller on shop_return_requests (seller_id);

drop policy if exists "People see whom they follow" on shop_follows;
create policy "People see whom they follow" on shop_follows
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "People follow shops" on shop_follows;
create policy "People follow shops" on shop_follows
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.seller_is_public(seller_id));

drop policy if exists "People unfollow shops" on shop_follows;
create policy "People unfollow shops" on shop_follows
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists "Returns are visible to the people involved" on shop_return_requests;
create policy "Returns are visible to the people involved" on shop_return_requests
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.is_admin())
    or (seller_id is not null and seller_id = (select public.current_seller_id()))
  );

drop policy if exists shop_reviews_select_public on shop_reviews;
create policy shop_reviews_select_public on shop_reviews
  for select to anon, authenticated
  using (
    not is_hidden
    or user_id = (select auth.uid())
    or (select public.is_admin())
    or public.seller_owns_product(product_id)
  );

-- One SELECT policy for vouchers; shops still insert/update/delete their own.
drop policy if exists "Live vouchers are public" on shop_vouchers;
drop policy if exists "Shops manage their vouchers" on shop_vouchers;
drop policy if exists "Vouchers are readable" on shop_vouchers;
drop policy if exists "Shops add vouchers" on shop_vouchers;
drop policy if exists "Shops change vouchers" on shop_vouchers;
drop policy if exists "Shops delete vouchers" on shop_vouchers;

create policy "Vouchers are readable" on shop_vouchers
  for select to anon, authenticated
  using (
    (is_active and public.seller_is_public(seller_id))
    or seller_id = (select public.current_seller_id())
    or (select public.is_admin())
  );

create policy "Shops add vouchers" on shop_vouchers
  for insert to authenticated
  with check (seller_id = (select public.current_seller_id()) or (select public.is_admin()));

create policy "Shops change vouchers" on shop_vouchers
  for update to authenticated
  using (seller_id = (select public.current_seller_id()) or (select public.is_admin()))
  with check (seller_id = (select public.current_seller_id()) or (select public.is_admin()));

create policy "Shops delete vouchers" on shop_vouchers
  for delete to authenticated
  using (seller_id = (select public.current_seller_id()) or (select public.is_admin()));

commit;
