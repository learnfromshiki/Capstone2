-- ============================================================================
-- CONNECT-Daet.ph - notifications, chat/review attachments and seller payments
-- Run this ONCE in Supabase -> SQL Editor, after
-- supabase-shipping-chat-gallery.sql.
--
-- What it adds:
--   1. shop-uploads bucket       - chat photos/videos, review photos, receipts, QR codes
--   2. shop_messages attachments - a photo or video inside a message
--   3. shop_reviews.photos       - photos a customer attaches to a review
--   4. shop_sellers payment info - GCash / bank details and QR codes per shop
--   5. shop_orders payment proof - the receipt the customer uploads
--   6. shop_notifications        - one inbox for customers, sellers and the admin,
--                                  filled automatically by database triggers
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. One public bucket for everything people attach
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'shop-uploads',
      'shop-uploads',
      true,
      26214400, -- 25 MB, enough for a short phone clip
      array[
        'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
        'video/mp4', 'video/webm', 'video/quicktime'
      ]
    )
    on conflict (id) do update
      set public = true,
          file_size_limit = 26214400,
          allowed_mime_types = array[
            'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
            'video/mp4', 'video/webm', 'video/quicktime'
          ];

    execute 'drop policy if exists "shop_uploads_read_public" on storage.objects';
    execute $policy$
      create policy "shop_uploads_read_public"
      on storage.objects for select
      to anon, authenticated
      using (bucket_id = 'shop-uploads')
    $policy$;

    -- Everyone writes only inside a folder named after their own user id.
    execute 'drop policy if exists "shop_uploads_insert_own_folder" on storage.objects';
    execute $policy$
      create policy "shop_uploads_insert_own_folder"
      on storage.objects for insert
      to authenticated
      with check (
        bucket_id = 'shop-uploads'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
    $policy$;

    execute 'drop policy if exists "shop_uploads_delete_own_folder" on storage.objects';
    execute $policy$
      create policy "shop_uploads_delete_own_folder"
      on storage.objects for delete
      to authenticated
      using (
        bucket_id = 'shop-uploads'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
    $policy$;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. A photo or video inside a message
-- ----------------------------------------------------------------------------
alter table shop_messages add column if not exists attachment_url text;
alter table shop_messages add column if not exists attachment_type text;

-- The body used to be required. A message may now be a photo on its own, so
-- the rule becomes "text or an attachment, and text stays under 2,000".
alter table shop_messages alter column body drop not null;
alter table shop_messages drop constraint if exists shop_messages_body_check;
alter table shop_messages drop constraint if exists shop_messages_content_check;
alter table shop_messages add constraint shop_messages_content_check
  check (
    coalesce(char_length(body), 0) <= 2000
    and (coalesce(btrim(body), '') <> '' or attachment_url is not null)
  );

alter table shop_messages drop constraint if exists shop_messages_attachment_type_check;
alter table shop_messages add constraint shop_messages_attachment_type_check
  check (attachment_type is null or attachment_type in ('image', 'video'));

-- ----------------------------------------------------------------------------
-- 3. Photos on a review
-- ----------------------------------------------------------------------------
-- ["https://.../a.jpg", "https://.../b.jpg"]
alter table shop_reviews add column if not exists photos jsonb not null default '[]'::jsonb;

alter table shop_reviews drop constraint if exists shop_reviews_photos_check;
alter table shop_reviews add constraint shop_reviews_photos_check
  check (jsonb_typeof(photos) = 'array' and jsonb_array_length(photos) <= 5);

-- ----------------------------------------------------------------------------
-- 4. How each shop wants to be paid
-- ----------------------------------------------------------------------------
alter table shop_sellers add column if not exists gcash_name text;
alter table shop_sellers add column if not exists gcash_number text;
alter table shop_sellers add column if not exists gcash_qr_url text;
alter table shop_sellers add column if not exists bank_name text;
alter table shop_sellers add column if not exists bank_account_name text;
alter table shop_sellers add column if not exists bank_account_number text;
alter table shop_sellers add column if not exists bank_qr_url text;

-- ----------------------------------------------------------------------------
-- 5. The receipt the customer uploads for GCash / bank transfer
-- ----------------------------------------------------------------------------
alter table shop_orders add column if not exists payment_proof_url text;
alter table shop_orders add column if not exists payment_reference text;
alter table shop_orders add column if not exists payment_proof_at timestamptz;

-- The buyer attaches the receipt right after place_order() created the order.
-- Written here rather than in the client so the order cannot be edited in any
-- other way, and so a receipt cannot be swapped once the shop has shipped.
create or replace function public.attach_payment_proof(
  p_order_id uuid,
  p_url text,
  p_reference text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_url text := nullif(btrim(coalesce(p_url, '')), '');
  v_reference text := nullif(btrim(coalesce(p_reference, '')), '');
begin
  if v_user is null then
    raise exception 'Please sign in first.' using errcode = '28000';
  end if;

  if v_url is null or v_url !~* '^https?://' then
    raise exception 'Please upload a photo of your payment receipt.' using errcode = '22023';
  end if;

  if length(v_url) > 1000 or length(coalesce(v_reference, '')) > 120 then
    raise exception 'That payment reference is too long.' using errcode = '22023';
  end if;

  update shop_orders
  set payment_proof_url = v_url,
      payment_reference = v_reference,
      payment_proof_at = now(),
      updated_at = now()
  where id = p_order_id
    and user_id = v_user
    and status in ('pending', 'confirmed');

  if not found then
    raise exception 'That order can no longer accept a new receipt.' using errcode = 'P0002';
  end if;

  return true;
end;
$$;

revoke all on function public.attach_payment_proof(uuid, text, text) from public, anon;
grant execute on function public.attach_payment_proof(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Notifications
-- ----------------------------------------------------------------------------
create table if not exists shop_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  audience text not null check (audience in ('customer', 'seller', 'admin')),
  kind text not null,
  title text not null,
  body text,
  link text,
  created_at timestamptz default now(),
  read_at timestamptz
);

create index if not exists idx_notifications_user
  on shop_notifications(user_id, created_at desc);
create index if not exists idx_notifications_unread
  on shop_notifications(user_id) where read_at is null;

alter table shop_notifications enable row level security;

-- Only ever your own. Nothing may be inserted from the browser: every
-- notification is written by one of the triggers below, which run as the
-- database owner.
drop policy if exists "notifications_select_own" on shop_notifications;
create policy "notifications_select_own"
  on shop_notifications for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "notifications_update_own" on shop_notifications;
create policy "notifications_update_own"
  on shop_notifications for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "notifications_delete_own" on shop_notifications;
create policy "notifications_delete_own"
  on shop_notifications for delete
  to authenticated
  using (user_id = auth.uid());

-- Put one notification in someone's inbox.
create or replace function public.push_notification(
  p_user_id uuid,
  p_audience text,
  p_kind text,
  p_title text,
  p_body text default null,
  p_link text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_user_id is null or coalesce(btrim(p_title), '') = '' then
    return;
  end if;

  insert into shop_notifications (user_id, audience, kind, title, body, link)
  values (p_user_id, p_audience, p_kind, left(p_title, 160), left(p_body, 400), p_link);
end;
$$;

-- Everyone who runs the admin dashboard.
create or replace function public.push_admin_notification(
  p_kind text,
  p_title text,
  p_body text default null,
  p_link text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into shop_notifications (user_id, audience, kind, title, body, link)
  select p.id, 'admin', p_kind, left(p_title, 160), left(p_body, 400), p_link
  from profiles p
  where p.user_type = 'admin';
end;
$$;

-- --- a new message tells the other side --------------------------------------
create or replace function public.notify_new_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conversation record;
  v_shop_name text;
  v_preview text;
begin
  select c.buyer_id, c.seller_id, c.buyer_name, s.user_id as seller_user_id, s.business_name
  into v_conversation
  from shop_conversations c
  left join shop_sellers s on s.id = c.seller_id
  where c.id = new.conversation_id;

  if not found then
    return new;
  end if;

  v_preview := coalesce(
    nullif(btrim(new.body), ''),
    case new.attachment_type when 'video' then 'Sent a video' else 'Sent a photo' end
  );

  if new.sender_role = 'buyer' then
    perform public.push_notification(
      v_conversation.seller_user_id,
      'seller',
      'message',
      'New message from ' || coalesce(nullif(btrim(v_conversation.buyer_name), ''), 'a customer'),
      v_preview,
      '/shop/seller/dashboard?tab=messages&conversation=' || new.conversation_id::text
    );
  else
    v_shop_name := coalesce(nullif(btrim(v_conversation.business_name), ''), 'the shop');
    perform public.push_notification(
      v_conversation.buyer_id,
      'customer',
      'message',
      'New message from ' || v_shop_name,
      v_preview,
      '/shop/buyer?tab=messages&conversation=' || new.conversation_id::text
    );
  end if;

  return new;
end;
$$;

drop trigger if exists notify_new_message on shop_messages;
create trigger notify_new_message
  after insert on shop_messages
  for each row execute function public.notify_new_message();

-- --- a new order tells the shop and the admin --------------------------------
create or replace function public.notify_new_order()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_seller_user uuid;
  v_shop_name text;
begin
  select s.user_id, s.business_name
  into v_seller_user, v_shop_name
  from shop_sellers s
  where s.id = new.seller_id;

  perform public.push_notification(
    v_seller_user,
    'seller',
    'order',
    'New order from ' || coalesce(nullif(btrim(new.customer_name), ''), 'a customer'),
    'Total ' || to_char(coalesce(new.total_amount, 0), 'FM999G999G999D00') || ' - waiting for you to confirm it.',
    '/shop/seller/dashboard?tab=orders&order=' || new.id::text
  );

  perform public.push_admin_notification(
    'order',
    'New order placed',
    coalesce(nullif(btrim(v_shop_name), ''), 'A shop') || ' received an order from ' ||
      coalesce(nullif(btrim(new.customer_name), ''), 'a customer') || '.',
    '/shop/admin?tab=orders'
  );

  return new;
end;
$$;

drop trigger if exists notify_new_order on shop_orders;
create trigger notify_new_order
  after insert on shop_orders
  for each row execute function public.notify_new_order();

-- --- a status change tells the customer --------------------------------------
create or replace function public.notify_order_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_label text;
  v_shop_name text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  v_label := case new.status
    when 'confirmed'  then 'has been confirmed'
    when 'processing' then 'is being prepared'
    when 'shipped'    then 'is on the way'
    when 'delivered'  then 'was delivered'
    when 'cancelled'  then 'was cancelled'
    else 'was updated'
  end;

  select s.business_name into v_shop_name from shop_sellers s where s.id = new.seller_id;

  perform public.push_notification(
    new.user_id,
    'customer',
    'order',
    'Your order ' || v_label,
    coalesce(nullif(btrim(v_shop_name), ''), 'The shop') ||
      case when new.status = 'shipped' then ' has shipped your order. Tap Order Received once it arrives.'
           else ' updated your order.' end,
    '/shop/buyer?tab=orders&order=' || new.id::text
  );

  -- The customer confirming delivery, or cancelling, is news for the shop too.
  if new.status in ('delivered', 'cancelled') then
    perform public.push_notification(
      (select s.user_id from shop_sellers s where s.id = new.seller_id),
      'seller',
      'order',
      'An order was ' || new.status,
      coalesce(nullif(btrim(new.customer_name), ''), 'A customer') || '''s order is now ' || new.status || '.',
      '/shop/seller/dashboard?tab=orders&order=' || new.id::text
    );
  end if;

  return new;
end;
$$;

drop trigger if exists notify_order_status on shop_orders;
create trigger notify_order_status
  after update of status on shop_orders
  for each row execute function public.notify_order_status();

-- --- a new shop, and its approval --------------------------------------------
create or replace function public.notify_new_shop()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.push_admin_notification(
    'shop',
    'New shop awaiting approval',
    new.business_name || ' signed up and is waiting to be approved.',
    '/shop/admin?tab=sellers'
  );
  return new;
end;
$$;

drop trigger if exists notify_new_shop on shop_sellers;
create trigger notify_new_shop
  after insert on shop_sellers
  for each row execute function public.notify_new_shop();

create or replace function public.notify_shop_decision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(new.is_approved, false) and not coalesce(old.is_approved, false) then
    perform public.push_notification(
      new.user_id, 'seller', 'shop',
      'Your shop is approved',
      new.business_name || ' is live. You can start adding products.',
      '/shop/seller/dashboard?tab=products'
    );
  elsif coalesce(new.is_rejected, false) and not coalesce(old.is_rejected, false) then
    perform public.push_notification(
      new.user_id, 'seller', 'shop',
      'Your shop application was declined',
      'Please contact CONNECT-Daet support if you think this is a mistake.',
      '/shop/seller/dashboard'
    );
  elsif coalesce(old.is_active, true) and not coalesce(new.is_active, true) then
    perform public.push_notification(
      new.user_id, 'seller', 'shop',
      'Your shop was deactivated',
      'Customers can no longer see your products. Contact support for help.',
      '/shop/seller/dashboard'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists notify_shop_decision on shop_sellers;
create trigger notify_shop_decision
  after update on shop_sellers
  for each row execute function public.notify_shop_decision();

-- --- a new review tells the shop ---------------------------------------------
create or replace function public.notify_new_review()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_seller_user uuid;
  v_product_name text;
begin
  select s.user_id, p.name
  into v_seller_user, v_product_name
  from shop_products p
  join shop_sellers s on s.id = p.seller_id
  where p.id = new.product_id;

  perform public.push_notification(
    v_seller_user,
    'seller',
    'review',
    new.rating || '-star review on ' || coalesce(v_product_name, 'your product'),
    coalesce(nullif(btrim(new.comment), ''), 'No comment was left.'),
    -- Straight to that product's reviews, not just the product list.
    '/shop/seller/dashboard?tab=products&product=' || new.product_id::text || '#reviews'
  );

  return new;
end;
$$;

drop trigger if exists notify_new_review on shop_reviews;
create trigger notify_new_review
  after insert on shop_reviews
  for each row execute function public.notify_new_review();

-- --- a customer being suspended tells them -----------------------------------
create or replace function public.notify_account_suspended()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(new.is_suspended, false) and not coalesce(old.is_suspended, false) then
    perform public.push_notification(
      new.id, 'customer', 'account',
      'Your account was suspended',
      'You can still browse, but you cannot place orders. Contact CONNECT-Daet support.',
      '/shop'
    );
  elsif not coalesce(new.is_suspended, false) and coalesce(old.is_suspended, false) then
    perform public.push_notification(
      new.id, 'customer', 'account',
      'Your account is active again',
      'Welcome back. You can place orders again.',
      '/shop'
    );
  end if;

  return new;
end;
$$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'is_suspended'
  ) then
    execute 'drop trigger if exists notify_account_suspended on profiles';
    execute 'create trigger notify_account_suspended after update on profiles
             for each row execute function public.notify_account_suspended()';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. Bigger profile pictures
-- ----------------------------------------------------------------------------
-- A photo straight off a phone is 4-8MB, and the old 2MB cap turned away most
-- of what people actually tried to upload. Storage enforces this itself, so
-- raising it in the app alone would not have been enough.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    update storage.buckets
    set file_size_limit = 10485760 -- 10 MB
    where id = 'profile-images';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 8. Gender on a customer profile
-- ----------------------------------------------------------------------------
alter table profiles add column if not exists gender text;

alter table profiles drop constraint if exists profiles_gender_check;
alter table profiles add constraint profiles_gender_check
  check (gender is null or gender in ('female', 'male', 'other'));

commit;

-- ============================================================================
-- Quick check after running (optional):
--   select count(*) from shop_notifications;
--   select id, public, file_size_limit from storage.buckets where id = 'shop-uploads';
-- ============================================================================
