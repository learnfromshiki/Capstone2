-- ============================================================================
-- ALL database changes from 2026-11-24, in the right order. Paste this whole
-- file into the Supabase SQL editor and run it once (safe to re-run).
-- It is the four files below, one after another:
--   supabase-order-received-after-shipping.sql
--   supabase-product-archive.sql
--   supabase-refund-notices-and-delivery.sql
--   supabase-audit-fixes.sql
-- ============================================================================


-- >>>>>>>>>>>>>>>>>>>> supabase-order-received-after-shipping.sql

-- ============================================================================
-- "Order Received" only after the shop has shipped the order (or made a pickup
-- order ready). A confirmed or processing order has not left the shop yet, so
-- the customer cannot mark it as received. (2026-11-24; included in
-- supabase-run-all-2026-11-24.sql.)
-- ============================================================================
create or replace function public.confirm_order_received(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_order record;
begin
  if v_user is null then
    raise exception 'Please sign in again.' using errcode = '28000';
  end if;

  select id, status, user_id into v_order
  from shop_orders
  where id = p_order_id
  for update;

  if not found or v_order.user_id is distinct from v_user then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;

  if v_order.status = 'delivered' then
    return jsonb_build_object('status', 'delivered');
  end if;

  if v_order.status <> 'shipped' then
    raise exception 'The shop has not shipped this order yet, so it cannot be marked as received.'
      using errcode = 'P0001';
  end if;

  update shop_orders
  set status = 'delivered',
      updated_at = now()
  where id = p_order_id;

  return jsonb_build_object('status', 'delivered');
end;
$$;

revoke all on function public.confirm_order_received(uuid) from public, anon;
grant execute on function public.confirm_order_received(uuid) to authenticated;

-- >>>>>>>>>>>>>>>>>>>> supabase-product-archive.sql

-- ============================================================================
-- Deleting a product that past orders point to archives it instead of
-- erasing the row: past orders and the shop's sales history stay complete,
-- and the product leaves the storefront (available = false) and the seller's
-- product list (archived_at is set). Run once in the Supabase SQL editor.
-- ============================================================================
alter table public.shop_products
  add column if not exists archived_at timestamptz;

-- An archived product can never be listed again.
create or replace function public.keep_archived_products_hidden()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.archived_at is not null then
    new.available := false;
  end if;
  return new;
end;
$$;

drop trigger if exists keep_archived_products_hidden on public.shop_products;
create trigger keep_archived_products_hidden
  before insert or update on public.shop_products
  for each row execute function public.keep_archived_products_hidden();

-- >>>>>>>>>>>>>>>>>>>> supabase-refund-notices-and-delivery.sql

-- ============================================================================
-- 2026-11-24 fixes. Run once in the Supabase SQL editor (safe to re-run).
--
-- 1. Clear notifications when a shop answers a cancel & refund or a return
--    request: which shop, which order, what happens next and the reason.
--    (It used to say only "Your request was declined" + the note.)
-- 2. shop_owner_avatars(): the owner's profile photo of each public shop, so
--    a customer's chat can show it (customers cannot read profiles rows).
-- 3. Order rules:
--    - only the customer (Order Received) or an admin marks an order
--      delivered; a shop's last step is Shipped / Ready for pickup;
--    - while a cancel & refund request is open, the shop has to answer it
--      before moving the order on (no more "Waiting for the shop" on an
--      order that was already delivered).
-- ============================================================================

-- 1. ------------------------------------------------------------------------
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
  v_shop text;
  v_number text;
  v_title text;
  v_body text;
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
  set status = v_status, response_note = v_note, updated_at = now(),
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

  select coalesce(nullif(btrim(s.business_name), ''), 'The shop') into v_shop
  from shop_sellers s where s.id = v_request.seller_id;
  v_shop := coalesce(v_shop, 'The shop');
  v_number := '#' || upper(left(v_request.order_id::text, 8));

  if not p_approve and v_request.kind = 'cancel_refund' then
    v_title := 'Cancel & refund request declined';
    v_body := v_shop || ' declined your request to cancel and refund order ' || v_number
           || '. The order goes ahead and no refund will be made. Reason: ' || v_note;
  elsif not p_approve then
    v_title := 'Return request declined';
    v_body := v_shop || ' declined your return request for order ' || v_number
           || ', so no refund will be made. Reason: ' || v_note;
  elsif v_request.kind = 'cancel_refund' then
    v_title := 'Refund approved';
    v_body := v_shop || ' approved your request: order ' || v_number
           || ' is cancelled and your money will be returned.'
           || coalesce(' Note: ' || v_note, '');
  else
    v_title := 'Return approved';
    v_body := v_shop || ' approved your return for order ' || v_number
           || '. They will message you about sending the item back.'
           || coalesce(' Note: ' || v_note, '');
  end if;

  perform public.push_notification(
    v_request.user_id, 'customer', 'order', v_title, v_body,
    '/shop/buyer?tab=orders&order=' || v_request.order_id);
  return v_status;
end;
$$;

revoke all on function public.respond_return(uuid, boolean, text) from public, anon;
grant execute on function public.respond_return(uuid, boolean, text) to authenticated;

-- 2. ------------------------------------------------------------------------
create or replace function public.shop_owner_avatars()
returns table (seller_id uuid, avatar_url text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.id, p.avatar_url
  from shop_sellers s
  join profiles p on p.id = s.user_id
  where s.is_approved and s.is_active
    and p.avatar_url is not null and p.avatar_url <> '';
$$;

revoke all on function public.shop_owner_avatars() from public, anon;
grant execute on function public.shop_owner_avatars() to authenticated;

-- 3. ------------------------------------------------------------------------
create or replace function public.guard_order_status_rules()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  -- Server jobs (no signed-in user), the automatic Order Received after
  -- shipping (auto_confirm_shipped_orders) and admins are not limited here.
  if v_uid is null or public.is_admin()
     or current_setting('app.auto_confirm', true) = 'true' then
    return new;
  end if;

  if new.status = 'delivered' and v_uid is distinct from new.user_id then
    raise exception 'Only the customer can mark this order as received. Set it to Shipped (or Ready for pickup) instead.'
      using errcode = 'P0001';
  end if;

  if new.status in ('confirmed', 'processing', 'shipped', 'delivered')
     and exists (select 1 from shop_return_requests r
                 where r.order_id = new.id and r.kind = 'cancel_refund' and r.status = 'requested') then
    raise exception 'The customer asked to cancel and refund this order. Approve or decline that request first.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_order_status_rules on public.shop_orders;
create trigger guard_order_status_rules
  before update of status on public.shop_orders
  for each row execute function public.guard_order_status_rules();

-- >>>>>>>>>>>>>>>>>>>> supabase-audit-fixes.sql

-- ============================================================================
-- 2026-11-24 audit fixes. Run AFTER supabase-refund-notices-and-delivery.sql.
-- Safe to re-run.
--
-- 1. Automatic Order Received: a shipped (or ready-for-pickup) order that the
--    customer has not confirmed within 7 days is marked delivered, so the
--    shop's earnings are released and the customer's points are granted.
--    Runs hourly through pg_cron when it can be enabled, and also whenever a
--    dashboard loads (auto_confirm_shipped_orders(), which only ever
--    completes orders that are already due).
-- 2. New orders can only be paid online (Xendit) or in cash; manual GCash and
--    bank transfer were removed from the store.
-- ============================================================================

-- 1. ------------------------------------------------------------------------
-- Days a customer has to tap Order Received (keep in sync with
-- AUTO_CONFIRM_DAYS in src/lib/orders.js).
alter table public.shop_orders add column if not exists shipped_at timestamptz;

-- Orders already shipped get the full 7 days from now.
update public.shop_orders
set shipped_at = now()
where status = 'shipped' and shipped_at is null;

create or replace function public.stamp_shipped_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'shipped' and old.status is distinct from 'shipped' then
    new.shipped_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists stamp_shipped_at on public.shop_orders;
create trigger stamp_shipped_at
  before update of status on public.shop_orders
  for each row execute function public.stamp_shipped_at();

create or replace function public.auto_confirm_shipped_orders()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  -- Lets guard_order_status_rules() allow this one system update.
  perform set_config('app.auto_confirm', 'true', true);

  update shop_orders
  set status = 'delivered',
      updated_at = now()
  where status = 'shipped'
    and shipped_at is not null
    and shipped_at < now() - interval '7 days';
  get diagnostics v_count = row_count;

  perform set_config('app.auto_confirm', 'false', true);
  return v_count;
end;
$$;

revoke all on function public.auto_confirm_shipped_orders() from public, anon;
grant execute on function public.auto_confirm_shipped_orders() to authenticated;

-- Hourly job, when pg_cron can be enabled on this project. If it cannot, the
-- dashboards still run the catch-up whenever they load.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'auto-confirm-shipped-orders';
  perform cron.schedule('auto-confirm-shipped-orders', '15 * * * *', 'select public.auto_confirm_shipped_orders()');
exception when others then
  raise notice 'pg_cron is not available (%); dashboards will run the catch-up instead.', sqlerrm;
end;
$$;

-- 2. ------------------------------------------------------------------------
create or replace function public.only_online_or_cash_orders()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.payment_method in ('gcash', 'bank') then
    raise exception 'Please pay online or with cash. GCash and bank transfer are paid online through Xendit now.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists only_online_or_cash_orders on public.shop_orders;
create trigger only_online_or_cash_orders
  before insert on public.shop_orders
  for each row execute function public.only_online_or_cash_orders();
