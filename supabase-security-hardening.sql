-- ============================================================================
-- CONNECT-Daet — production security hardening
-- ============================================================================
-- Run this ONCE in the Supabase SQL Editor with a database owner / service
-- role. It cannot be applied with the anon key used by the web app.
--
-- What this migration does:
--   1. Adds any missing columns/constraints used by the current UI.
--   2. Replaces every permissive "for testing" policy with ownership- and
--      role-based policies (buyers, approved sellers, admins).
--   3. Protects privileged profile/seller/order fields with triggers so a
--      client cannot promote itself, change points, or rewrite an order.
--   4. Adds the atomic, idempotent add_reward_points() RPC used by the app.
--   5. Fixes the seller-earnings trigger to release on "delivered" (the app
--      never uses the old "completed" status).
--
-- Safety: every object is CREATE OR REPLACE / IF NOT EXISTS, and all existing
-- policies on the application tables are dropped before the secure set is
-- created, so the file is safe to re-run.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Columns and constraints expected by the current application
-- ----------------------------------------------------------------------------
alter table if exists profiles add column if not exists email text;
alter table if exists profiles add column if not exists full_name text;
alter table if exists profiles add column if not exists phone text;
alter table if exists profiles add column if not exists address text;
alter table if exists profiles add column if not exists avatar_url text;
alter table if exists profiles add column if not exists is_suspended boolean default false;
alter table if exists profiles add column if not exists points integer default 0;
alter table if exists profiles add column if not exists user_type text default 'tourist';
alter table if exists profiles add column if not exists updated_at timestamptz default now();

alter table if exists shop_sellers add column if not exists logo_url text;
alter table if exists shop_sellers add column if not exists description text;
alter table if exists shop_sellers add column if not exists commission_rate numeric(5,2) default 15.00;
alter table if exists shop_sellers add column if not exists is_rejected boolean default false;
alter table if exists shop_sellers add column if not exists updated_at timestamptz default now();

alter table if exists shop_products add column if not exists seller_id uuid;
alter table if exists shop_products add column if not exists available boolean default true;
alter table if exists shop_products add column if not exists updated_at timestamptz default now();

alter table if exists shop_orders add column if not exists updated_at timestamptz default now();

alter table if exists reward_history add column if not exists reference_id uuid;

-- One review per buyer per product. The client already hides reviewed items,
-- but the constraint protects against direct API calls and double taps.
create unique index if not exists shop_reviews_one_per_user_product
  on shop_reviews(user_id, product_id)
  where user_id is not null and product_id is not null;

-- Idempotency for reward grants. add_reward_points() uses this to make a
-- retried checkout award points exactly once.
create unique index if not exists reward_history_reference_unique
  on reward_history(user_id, reference_id)
  where reference_id is not null;

create index if not exists idx_shop_products_seller_id
  on shop_products(seller_id);
create index if not exists idx_shop_order_items_product_id
  on shop_order_items(product_id);
create index if not exists idx_shop_sellers_user_id
  on shop_sellers(user_id);

-- ----------------------------------------------------------------------------
-- 2. Helper functions (security definer avoids RLS recursion in policies)
-- ----------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and user_type = 'admin'
  );
$$;

create or replace function public.account_is_active()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select not coalesce(p.is_suspended, false)
    from profiles p
    where p.id = auth.uid()
  ), false);
$$;

create or replace function public.current_seller_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.id
  from shop_sellers s
  where s.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.seller_can_sell()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from shop_sellers s
    where s.user_id = auth.uid()
      and s.is_approved = true
      and s.is_active = true
      and coalesce(s.is_rejected, false) = false
  );
$$;

-- True when a seller row is publicly shoppable (approved, active, not rejected).
create or replace function public.seller_is_public(p_seller_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from shop_sellers s
    where s.id = p_seller_id
      and s.is_approved = true
      and s.is_active = true
      and coalesce(s.is_rejected, false) = false
  );
$$;

-- True when the signed-in user owns the seller row behind a product. Also
-- returns true for platform products with no seller only for admins, which is
-- handled separately in the policies below.
create or replace function public.seller_owns_product(p_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from shop_products p
    join shop_sellers s on s.id = p.seller_id
    where p.id = p_product_id
      and s.user_id = auth.uid()
  );
$$;

-- True when an order contains at least one product owned by the signed-in user.
create or replace function public.seller_owns_order(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from shop_order_items oi
    join shop_products p on p.id = oi.product_id
    join shop_sellers s on s.id = p.seller_id
    where oi.order_id = p_order_id
      and s.user_id = auth.uid()
  );
$$;

grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.account_is_active() to authenticated;
grant execute on function public.current_seller_id() to authenticated;
grant execute on function public.seller_can_sell() to authenticated;
grant execute on function public.seller_is_public(uuid) to anon, authenticated;
grant execute on function public.seller_owns_product(uuid) to authenticated;
grant execute on function public.seller_owns_order(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Privileged-field guards
-- ----------------------------------------------------------------------------
-- A normal user may edit their name, phone and address, but not their role,
-- points, suspension state or login email.
create or replace function public.protect_profile_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- add_reward_points() sets this transaction-local flag before it changes
  -- points; it is not exposed through the Data API.
  if coalesce(current_setting('app.allow_privileged_profile_update', true), 'false') = 'true' then
    return new;
  end if;

  if auth.uid() is not null
     and auth.uid() = old.id
     and not public.is_admin() then
    new.user_type := old.user_type;
    new.is_suspended := old.is_suspended;
    new.points := old.points;
    new.email := old.email;
  end if;

  return new;
end;
$$;

drop trigger if exists protect_profile_privileged_fields on profiles;
create trigger protect_profile_privileged_fields
  before update on profiles
  for each row
  execute function public.protect_profile_privileged_fields();

-- A normal buyer may only change stock during checkout/reservation rollback.
-- Every other product field is pinned to its previous value so prices, names,
-- sellers and availability cannot be tampered with.
create or replace function public.protect_product_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() and not public.seller_owns_product(old.id) then
    new.id := old.id;
    new.name := old.name;
    new.description := old.description;
    new.price := old.price;
    new.category := old.category;
    new.image_url := old.image_url;
    new.seller_id := old.seller_id;
    new.artisan_name := old.artisan_name;
    new.available := old.available;
    new.created_at := old.created_at;
  end if;

  return new;
end;
$$;

drop trigger if exists protect_product_fields on shop_products;
create trigger protect_product_fields
  before update on shop_products
  for each row
  execute function public.protect_product_fields();

-- Sellers may edit their shop details, but only an admin may approve, reject,
-- suspend, re-commission or transfer a seller account.
create or replace function public.protect_seller_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null
     and auth.uid() = old.user_id
     and not public.is_admin() then
    new.user_id := old.user_id;
    new.is_approved := old.is_approved;
    new.is_rejected := old.is_rejected;
    new.is_active := old.is_active;
    new.commission_rate := old.commission_rate;
  end if;

  return new;
end;
$$;

drop trigger if exists protect_seller_privileged_fields on shop_sellers;
create trigger protect_seller_privileged_fields
  before update on shop_sellers
  for each row
  execute function public.protect_seller_privileged_fields();

-- Sellers may move an order through its status flow, but they cannot rewrite
-- the buyer's details, payment method, notes or total. Admins keep full access.
create or replace function public.protect_order_customer_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    new.user_id := old.user_id;
    new.customer_name := old.customer_name;
    new.customer_email := old.customer_email;
    new.customer_phone := old.customer_phone;
    new.delivery_address := old.delivery_address;
    new.payment_method := old.payment_method;
    new.total_amount := old.total_amount;
    new.notes := old.notes;
  end if;

  return new;
end;
$$;

drop trigger if exists protect_order_customer_fields on shop_orders;
create trigger protect_order_customer_fields
  before update on shop_orders
  for each row
  execute function public.protect_order_customer_fields();

-- ----------------------------------------------------------------------------
-- 4. Remove every old policy on the application-owned tables
-- ----------------------------------------------------------------------------
do $$
declare
  target_tables text[] := array[
    'profiles',
    'reward_history',
    'shop_sellers',
    'shop_products',
    'shop_orders',
    'shop_order_items',
    'shop_reviews',
    'shop_categories',
    'shop_settings',
    'shop_seller_earnings'
  ];
  pol record;
begin
  for pol in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = any(target_tables)
  loop
    execute format('drop policy if exists %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Profiles
-- ----------------------------------------------------------------------------
alter table profiles enable row level security;

create policy "profiles_select_own_or_admin"
  on profiles for select
  to authenticated
  using (auth.uid() = id or public.is_admin());

create policy "profiles_insert_self"
  on profiles for insert
  to authenticated
  with check (
    auth.uid() = id
    and coalesce(user_type, 'tourist') in ('tourist', 'seller')
    and coalesce(is_suspended, false) = false
    and coalesce(points, 0) = 0
  );

create policy "profiles_update_own_or_admin"
  on profiles for update
  to authenticated
  using (auth.uid() = id or public.is_admin())
  with check (auth.uid() = id or public.is_admin());

create policy "profiles_delete_admin"
  on profiles for delete
  to authenticated
  using (public.is_admin());

-- ----------------------------------------------------------------------------
-- 6. Reward history + atomic points RPC
-- ----------------------------------------------------------------------------
alter table reward_history enable row level security;

create policy "reward_history_select_own_or_admin"
  on reward_history for select
  to authenticated
  using (auth.uid() = user_id or public.is_admin());

-- Deliberately no INSERT policy: rewards can only be written by the
-- SECURITY DEFINER function below, which locks the profile row and enforces
-- idempotency. This stops clients from minting points/history.

create or replace function public.add_reward_points(
  p_points integer,
  p_source text,
  p_reference uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_points integer;
  v_source text := nullif(trim(coalesce(p_source, '')), '');
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if p_points is null or p_points <= 0 or p_points > 100000 then
    raise exception 'Invalid points amount' using errcode = '22023';
  end if;

  if v_source is null then
    raise exception 'Invalid reward source' using errcode = '22023';
  end if;

  -- Lock the profile row so concurrent checkout retries cannot double-award.
  select points into v_points
  from profiles
  where id = v_user
  for update;

  if not found then
    raise exception 'Profile not found' using errcode = '23503';
  end if;

  if p_reference is not null and exists (
    select 1 from reward_history
    where user_id = v_user and reference_id = p_reference
  ) then
    return coalesce(v_points, 0);
  end if;

  -- Allow this definer function to write points past the profile guard trigger.
  perform set_config('app.allow_privileged_profile_update', 'true', true);

  update profiles
  set points = coalesce(v_points, 0) + p_points,
      updated_at = now()
  where id = v_user
  returning points into v_points;

  insert into reward_history (user_id, subsystem_source, points_earned, reference_id)
  values (v_user, left(v_source, 100), p_points, p_reference);

  return v_points;
end;
$$;

revoke all on function public.add_reward_points(integer, text, uuid) from public;
grant execute on function public.add_reward_points(integer, text, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. Sellers
-- ----------------------------------------------------------------------------
alter table shop_sellers enable row level security;

create policy "shop_sellers_select_public_or_own_or_admin"
  on shop_sellers for select
  to anon, authenticated
  using (
    public.is_admin()
    or user_id = auth.uid()
    or (
      is_approved = true
      and is_active = true
      and coalesce(is_rejected, false) = false
    )
  );

create policy "shop_sellers_insert_self_pending"
  on shop_sellers for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and is_approved = false
    and coalesce(is_rejected, false) = false
    and is_active = true
    and coalesce(commission_rate, 15.00) = 15.00
  );

create policy "shop_sellers_update_own_or_admin"
  on shop_sellers for update
  to authenticated
  using (auth.uid() = user_id or public.is_admin())
  with check (auth.uid() = user_id or public.is_admin());

create policy "shop_sellers_delete_admin"
  on shop_sellers for delete
  to authenticated
  using (public.is_admin());

-- ----------------------------------------------------------------------------
-- 8. Products
-- ----------------------------------------------------------------------------
alter table shop_products enable row level security;

create policy "shop_products_select_public_or_own_or_admin"
  on shop_products for select
  to anon, authenticated
  using (
    public.is_admin()
    or public.seller_owns_product(id)
    or (
      available = true
      and (seller_id is null or public.seller_is_public(seller_id))
    )
  );

create policy "shop_products_insert_approved_seller_or_admin"
  on shop_products for insert
  to authenticated
  with check (
    public.is_admin()
    or (
      public.seller_can_sell()
      and seller_id = public.current_seller_id()
    )
  );

create policy "shop_products_update_owned_or_admin"
  on shop_products for update
  to authenticated
  using (
    public.is_admin()
    or (public.seller_can_sell() and seller_id = public.current_seller_id())
  )
  with check (
    public.is_admin()
    or (public.seller_can_sell() and seller_id = public.current_seller_id())
  );

-- Buyers need to reserve/release stock while checking out. protect_product_fields()
-- pins everything except stock for non-owners, so this cannot rewrite prices.
create policy "shop_products_update_stock_for_checkout"
  on shop_products for update
  to authenticated
  using (public.account_is_active())
  with check (public.account_is_active() and stock >= 0);

create policy "shop_products_delete_owned_or_admin"
  on shop_products for delete
  to authenticated
  using (
    public.is_admin()
    or seller_id = public.current_seller_id()
  );

-- ----------------------------------------------------------------------------
-- 9. Orders
-- ----------------------------------------------------------------------------
alter table shop_orders enable row level security;

create policy "shop_orders_select_buyer_seller_admin"
  on shop_orders for select
  to authenticated
  using (
    public.is_admin()
    or user_id = auth.uid()
    or public.seller_owns_order(id)
  );

create policy "shop_orders_insert_own_active_account"
  on shop_orders for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and public.account_is_active()
    and status = 'pending'
    and total_amount > 0
    and payment_method in ('gcash', 'cod', 'bank')
    and length(trim(coalesce(customer_name, ''))) > 0
    and length(trim(coalesce(customer_email, ''))) > 0
    and length(trim(coalesce(customer_phone, ''))) > 0
    and length(trim(coalesce(delivery_address, ''))) > 0
  );

-- Buyers cannot update orders. Sellers can update orders containing their
-- products, and the guard trigger keeps every customer field immutable.
create policy "shop_orders_update_seller_or_admin"
  on shop_orders for update
  to authenticated
  using (public.is_admin() or public.seller_owns_order(id))
  with check (public.is_admin() or public.seller_owns_order(id));

-- A buyer may remove their own unprocessed order (used by checkout rollback).
create policy "shop_orders_delete_own_pending_or_admin"
  on shop_orders for delete
  to authenticated
  using (
    public.is_admin()
    or (user_id = auth.uid() and status = 'pending')
  );

-- ----------------------------------------------------------------------------
-- 10. Order items
-- ----------------------------------------------------------------------------
alter table shop_order_items enable row level security;

create policy "shop_order_items_select_buyer_seller_admin"
  on shop_order_items for select
  to authenticated
  using (
    public.is_admin()
    or public.seller_owns_product(product_id)
    or exists (
      select 1
      from shop_orders o
      where o.id = order_id
        and o.user_id = auth.uid()
    )
  );

create policy "shop_order_items_insert_own_pending_order"
  on shop_order_items for insert
  to authenticated
  with check (
    exists (
      select 1
      from shop_orders o
      where o.id = order_id
        and o.user_id = auth.uid()
        and o.status = 'pending'
    )
  );

create policy "shop_order_items_delete_own_pending_or_admin"
  on shop_order_items for delete
  to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
      from shop_orders o
      where o.id = order_id
        and o.user_id = auth.uid()
        and o.status = 'pending'
    )
  );

-- ----------------------------------------------------------------------------
-- 11. Reviews (only delivered purchases can be reviewed)
-- ----------------------------------------------------------------------------
alter table shop_reviews enable row level security;

create policy "shop_reviews_select_public"
  on shop_reviews for select
  to anon, authenticated
  using (true);

create policy "shop_reviews_insert_delivered_purchase"
  on shop_reviews for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and rating between 1 and 5
    and exists (
      select 1
      from shop_order_items oi
      join shop_orders o on o.id = oi.order_id
      where oi.product_id = shop_reviews.product_id
        and o.user_id = auth.uid()
        and o.status = 'delivered'
    )
  );

create policy "shop_reviews_delete_own_or_admin"
  on shop_reviews for delete
  to authenticated
  using (auth.uid() = user_id or public.is_admin());

-- ----------------------------------------------------------------------------
-- 12. Categories
-- ----------------------------------------------------------------------------
alter table shop_categories enable row level security;

create policy "shop_categories_select_public"
  on shop_categories for select
  to anon, authenticated
  using (true);

create policy "shop_categories_insert_seller_or_admin"
  on shop_categories for insert
  to authenticated
  with check (public.is_admin() or public.seller_can_sell());

create policy "shop_categories_update_admin"
  on shop_categories for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "shop_categories_delete_admin"
  on shop_categories for delete
  to authenticated
  using (public.is_admin());

-- ----------------------------------------------------------------------------
-- 13. Website settings
-- ----------------------------------------------------------------------------
alter table if exists shop_settings enable row level security;

drop policy if exists "shop_settings_select_public" on shop_settings;
create policy "shop_settings_select_public"
  on shop_settings for select
  to anon, authenticated
  using (true);

drop policy if exists "shop_settings_write_admin" on shop_settings;
create policy "shop_settings_write_admin"
  on shop_settings for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- 14. Seller earnings (read-only to the owning seller)
-- ----------------------------------------------------------------------------
alter table if exists shop_seller_earnings enable row level security;

drop policy if exists "shop_seller_earnings_select_own_or_admin" on shop_seller_earnings;
create policy "shop_seller_earnings_select_own_or_admin"
  on shop_seller_earnings for select
  to authenticated
  using (
    public.is_admin()
    or seller_id = public.current_seller_id()
  );

-- ----------------------------------------------------------------------------
-- 15. Earnings trigger fix: release on delivered, cancel on cancellation
-- ----------------------------------------------------------------------------
create or replace function public.update_seller_earnings_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' then
    update shop_seller_earnings
    set status = 'paid', paid_at = now()
    where order_id = new.id and status = 'pending';
  end if;

  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    update shop_seller_earnings
    set status = 'cancelled'
    where order_id = new.id and status = 'pending';
  end if;

  return new;
end;
$$;

drop trigger if exists trigger_update_seller_earnings_status on shop_orders;
create trigger trigger_update_seller_earnings_status
  after update on shop_orders
  for each row
  when (old.status is distinct from new.status)
  execute function public.update_seller_earnings_status();

-- ----------------------------------------------------------------------------
-- 16. Data hygiene: un-reject any seller whose flags contradict each other
-- ----------------------------------------------------------------------------
update shop_sellers
set is_rejected = false
where is_rejected is null;

commit;

-- ============================================================================
-- Verification (optional, run after COMMIT):
--   select tablename, policyname, cmd from pg_policies
--   where schemaname = 'public'
--   order by tablename, policyname;
--
--   select proname, prosecdef from pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname in ('add_reward_points','is_admin','seller_owns_order');
-- ============================================================================
