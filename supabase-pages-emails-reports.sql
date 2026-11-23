-- ============================================================================
-- Review totals, order emails, reports, and deleting your own account
-- (2026-11-23). Needs supabase-feature-audit.sql first. Safe to re-run.
--
--   * product_review_summaries(): average + count per product for every
--     product, so the shop no longer depends on the 300 newest reviews
--   * order emails (Brevo, through send_app_email): order received,
--     payment received, shipped / ready for pickup, delivered, cancelled,
--     refunded
--   * shop_reports: shoppers report a product or a shop; the admin reviews
--   * delete_my_account(): a customer deletes their own account; past
--     orders stay for the shops' records with the personal details removed
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Review totals per product
-- ---------------------------------------------------------------------------
create or replace function public.product_review_summaries()
returns table (product_id uuid, average numeric, review_count bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.product_id, round(avg(r.rating)::numeric, 2), count(*)::bigint
  from shop_reviews r
  where r.product_id is not null and not r.is_hidden
  group by r.product_id;
$$;

revoke all on function public.product_review_summaries() from public;
grant execute on function public.product_review_summaries() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Order emails
-- ---------------------------------------------------------------------------

-- Escape text that came from people (product, shop and customer names).
create or replace function public._html(p_text text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select replace(replace(replace(replace(coalesce(p_text, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;');
$$;

create or replace function public._send_order_email(p_order_id uuid, p_subject text, p_heading text, p_message text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order record;
  v_shop text;
  v_items text := '';
  v_item record;
  v_site text := coalesce(public.app_secret('site_url'), 'https://capstone2-tawny-iota.vercel.app');
  v_number text := upper(left(p_order_id::text, 8));
begin
  select o.*, coalesce(u.email, o.customer_email) as to_email
  into v_order
  from shop_orders o
  left join auth.users u on u.id = o.user_id
  where o.id = p_order_id;

  if not found or coalesce(v_order.to_email, '') = '' or v_order.to_email like '%@deleted.invalid' then
    return;
  end if;

  select business_name into v_shop from shop_sellers where id = v_order.seller_id;

  for v_item in
    select product_name, quantity, price, options from shop_order_items where order_id = p_order_id order by product_name
  loop
    v_items := v_items
      || '<tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb">'
      || public._html(v_item.product_name)
      || coalesce('<br><span style="color:#6b7280;font-size:12px">'
           || public._html((select string_agg(key || ': ' || value, ', ') from jsonb_each_text(v_item.options))) || '</span>', '')
      || '</td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;text-align:center">× ' || v_item.quantity
      || '</td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;text-align:right">PHP '
      || to_char(v_item.price * v_item.quantity, 'FM999,999,990.00') || '</td></tr>';
  end loop;

  perform public.send_app_email(
    v_order.to_email,
    v_order.customer_name,
    p_subject || ' · Order ' || v_number,
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#111827">'
    || '<h2 style="color:#1d4ed8;margin:0 0 8px">' || public._html(p_heading) || '</h2>'
    || '<p style="margin:0 0 16px">' || public._html(p_message) || '</p>'
    || '<p style="margin:0 0 4px;color:#6b7280;font-size:13px">Order <strong>' || v_number || '</strong>'
    || coalesce(' from <strong>' || public._html(v_shop) || '</strong>', '') || '</p>'
    || '<table style="width:100%;border-collapse:collapse;font-size:14px;margin:8px 0 12px">' || v_items || '</table>'
    || case when coalesce(v_order.voucher_discount, 0) > 0
         then '<p style="margin:0;font-size:13px">Shop voucher ' || public._html(v_order.voucher_code) || ': −PHP '
              || to_char(v_order.voucher_discount, 'FM999,999,990.00') || '</p>' else '' end
    || case when coalesce(v_order.points_discount, 0) > 0
         then '<p style="margin:0;font-size:13px">Reward points: −PHP ' || to_char(v_order.points_discount, 'FM999,999,990.00') || '</p>' else '' end
    || case when coalesce(v_order.shipping_fee, 0) > 0
         then '<p style="margin:0;font-size:13px">Delivery: PHP ' || to_char(v_order.shipping_fee, 'FM999,999,990.00') || '</p>' else '' end
    || '<p style="margin:8px 0 20px;font-size:16px"><strong>Total: PHP ' || to_char(v_order.total_amount, 'FM999,999,990.00') || '</strong></p>'
    || '<p><a href="' || v_site || '/shop/buyer?tab=orders&order=' || p_order_id || '" '
    || 'style="background:#2563eb;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">View my order</a></p>'
    || '<p style="color:#6b7280;font-size:12px;margin-top:24px">CONNECT-Daet.ph · Supporting local artisans of Daet, Camarines Norte.</p>'
    || '</div>'
  );
end;
$$;

-- Order received. Deferred to the end of the transaction, so the items
-- place_order() writes after the order row are in the email.
create or replace function public.email_order_placed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._send_order_email(
    new.id,
    'Order received',
    'Thank you for your order!',
    case
      when new.payment_method = 'xendit' then 'We saved your order. It is confirmed as soon as your online payment arrives.'
      when new.fulfillment_method = 'pickup' then 'The shop will prepare it and let you know when it is ready for pickup.'
      else 'The shop will confirm it soon and let you know when it ships.'
    end
  );
  return null;
end;
$$;

drop trigger if exists email_order_placed on shop_orders;
create constraint trigger email_order_placed
  after insert on shop_orders
  deferrable initially deferred
  for each row execute function public.email_order_placed();

create or replace function public.email_order_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pickup boolean := new.fulfillment_method = 'pickup';
begin
  if new.payment_status is distinct from old.payment_status then
    if new.payment_status = 'paid' and new.status <> 'cancelled' then
      perform public._send_order_email(new.id, 'Payment received', 'We received your payment',
        'Your online payment went through. The shop can now prepare your order.');
    elsif new.payment_status = 'refunded' then
      perform public._send_order_email(new.id, 'Refund sent', 'Your refund was sent',
        'The money for this order was returned to you. It can take a few days to show in your account.');
    end if;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'shipped' then
      perform public._send_order_email(new.id,
        case when v_pickup then 'Ready for pickup' else 'Order shipped' end,
        case when v_pickup then 'Your order is ready for pickup' else 'Your order is on the way' end,
        case when v_pickup then 'Pick it up at the shop and tap Order Received once you have it.'
             else 'Tap Order Received in your account once it arrives.'
             || coalesce(' Tracking: ' || nullif(btrim(coalesce(new.courier, '') || ' ' || coalesce(new.tracking_number, '')), ''), '') end);
    elsif new.status = 'delivered' then
      perform public._send_order_email(new.id,
        case when v_pickup then 'Order picked up' else 'Order delivered' end,
        'Enjoy your order!',
        'You can now rate what you bought. Something wrong? You can ask for a return within 7 days.');
    elsif new.status = 'cancelled' then
      perform public._send_order_email(new.id, 'Order cancelled', 'Your order was cancelled',
        coalesce('Reason: ' || nullif(btrim(new.cancel_reason), '') || '. ', '')
        || case when new.payment_status = 'paid' then 'Your payment will be refunded.' else 'You were not charged.' end);
    end if;
  end if;

  return null;
end;
$$;

drop trigger if exists email_order_update on shop_orders;
create trigger email_order_update
  after update of status, payment_status on shop_orders
  for each row execute function public.email_order_update();

revoke execute on function public._send_order_email(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.email_order_placed() from public, anon, authenticated;
revoke execute on function public.email_order_update() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------
create table if not exists shop_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('product', 'shop')),
  product_id uuid references shop_products(id) on delete cascade,
  seller_id uuid references shop_sellers(id) on delete cascade,
  reason text not null check (length(btrim(reason)) between 1 and 200),
  details text check (details is null or length(details) <= 1000),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  admin_note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint shop_reports_target check (
    (target_type = 'product' and product_id is not null) or (target_type = 'shop' and seller_id is not null)
  )
);

create index if not exists shop_reports_reporter on shop_reports (reporter_id);
create index if not exists shop_reports_product on shop_reports (product_id);
create index if not exists shop_reports_seller on shop_reports (seller_id);
-- One open report per person per product or shop.
create unique index if not exists shop_reports_one_open
  on shop_reports (reporter_id, target_type, coalesce(product_id, seller_id)) where status = 'open';

alter table shop_reports enable row level security;

drop policy if exists "People report" on shop_reports;
create policy "People report" on shop_reports
  for insert to authenticated
  with check (reporter_id = (select auth.uid()) and status = 'open' and admin_note is null);

drop policy if exists "Reports are seen by their writer and the admin" on shop_reports;
create policy "Reports are seen by their writer and the admin" on shop_reports
  for select to authenticated
  using (reporter_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "The admin handles reports" on shop_reports;
create policy "The admin handles reports" on shop_reports
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

grant select, insert, update on shop_reports to authenticated;

create or replace function public.notify_new_report()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
begin
  if new.target_type = 'product' then
    select name into v_name from shop_products where id = new.product_id;
  else
    select business_name into v_name from shop_sellers where id = new.seller_id;
  end if;

  perform public.push_admin_notification(
    'report',
    'New report: ' || coalesce(v_name, new.target_type),
    new.reason,
    '/shop/admin?tab=reports-abuse'
  );
  return new;
end;
$$;

drop trigger if exists notify_new_report on shop_reports;
create trigger notify_new_report
  after insert on shop_reports
  for each row execute function public.notify_new_report();

revoke execute on function public.notify_new_report() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Delete my account (customers)
-- ---------------------------------------------------------------------------
create or replace function public.delete_my_account(p_confirm text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_order uuid;
  v_tag text;
begin
  if v_user is null then
    raise exception 'Please sign in again.' using errcode = '28000';
  end if;

  if coalesce(p_confirm, '') <> 'DELETE' then
    raise exception 'Type DELETE to confirm.' using errcode = '22023';
  end if;

  if public.is_admin() then
    raise exception 'Admin accounts cannot be deleted here.' using errcode = '42501';
  end if;

  if exists (select 1 from shop_sellers where user_id = v_user) then
    raise exception 'This account owns a shop. Please contact the CONNECT-Daet admin to close the shop first.'
      using errcode = 'P0001';
  end if;

  -- Orders a shop is already handling, or money still to be settled.
  if exists (
    select 1 from shop_orders
    where user_id = v_user
      and (status in ('confirmed', 'processing', 'shipped')
           or (status = 'pending' and payment_status = 'paid'))
  ) or exists (
    select 1 from shop_return_requests where user_id = v_user and status in ('requested', 'approved')
  ) then
    raise exception 'You have orders, returns or refunds still in progress. Please wait until they are finished.'
      using errcode = 'P0001';
  end if;

  -- Orders nobody has started yet are cancelled (stock, points, vouchers back).
  for v_order in
    select id from shop_orders where user_id = v_user and status = 'pending' order by id for update
  loop
    perform public._cancel_order_internal(v_order);
  end loop;

  -- Past orders stay for the shops' sales records, without personal details.
  v_tag := left(v_user::text, 8);
  perform set_config('app.trusted_order_update', 'true', true);
  update shop_orders
  set customer_name = 'Deleted customer',
      customer_email = 'deleted-' || v_tag || '@deleted.invalid',
      customer_phone = '',
      delivery_address = case when fulfillment_method = 'pickup' then delivery_address else 'Removed at the customer''s request' end,
      notes = null,
      updated_at = now()
  where user_id = v_user;
  perform set_config('app.trusted_order_update', 'false', true);

  update shop_reviews
  set reviewer_name = 'Former customer', reviewer_avatar_url = null
  where user_id = v_user;

  -- Profile, cart, follows, chats, notifications and returns go with the
  -- login (on delete cascade).
  delete from auth.users where id = v_user;
end;
$$;

revoke all on function public.delete_my_account(text) from public, anon;
grant execute on function public.delete_my_account(text) to authenticated;

commit;
