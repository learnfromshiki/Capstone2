-- ============================================================================
-- !! DO NOT RUN AGAINST THE LIVE DATABASE !!
-- Contains "for admin testing" policies such as
--   create policy "Anyone can read profiles" for select using (true);
--   create policy "Allow profile updates for admin testing" for update using (true);
-- which expose every profile to anyone with the public anon key (and allow
-- self-promotion to user_type = 'admin'). supabase-security-hardening.sql
-- drops and replaces them, so re-running this file silently re-opens the holes.
-- ============================================================================
-- =====================================================
-- CONNECT-Daet.ph - Admin permissions, seller rejection
-- and shared website settings
-- Run this whole file in the Supabase SQL Editor.
-- Safe to re-run: every statement is guarded.
-- =====================================================

-- =====================================================
-- PART 1 - profiles / reward_history (needed by the app)
-- The app reads profiles.full_name, profiles.email,
-- profiles.points and profiles.user_type.
-- =====================================================

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  phone text,
  address text,
  avatar_url text,
  points integer default 0,
  user_type text default 'tourist',
  is_suspended boolean default false,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Upgrade a profiles table created by an older script
alter table profiles add column if not exists email text;
alter table profiles add column if not exists avatar_url text;
alter table profiles add column if not exists phone text;
alter table profiles add column if not exists address text;
alter table profiles add column if not exists is_suspended boolean default false;
alter table profiles add column if not exists points integer default 0;
alter table profiles add column if not exists user_type text default 'tourist';
alter table profiles add column if not exists updated_at timestamp with time zone default now();

create table if not exists reward_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  subsystem_source text not null,
  points_earned integer not null,
  created_at timestamp with time zone default now()
);

-- Fill profiles for accounts that already exist
insert into profiles (id, full_name, email)
select
  u.id,
  coalesce(u.raw_user_meta_data->>'full_name', u.email),
  u.email
from auth.users u
on conflict (id) do nothing;

update profiles p
set email = u.email
from auth.users u
where p.id = u.id and p.email is null;

-- New signups get a profile automatically
create or replace function create_profile_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.email
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function create_profile_on_signup();

-- =====================================================
-- PART 2 - Helper: is the current user an admin?
-- =====================================================

create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and user_type = 'admin'
  );
$$;

-- =====================================================
-- PART 3 - profiles policies
-- NOTE: the read policy is open so the admin dashboard can
-- list buyers even while using the demo admin login.
-- Harden it to (auth.uid() = id or is_admin()) once every
-- admin signs in with a real Supabase account.
-- =====================================================

alter table profiles enable row level security;

drop policy if exists "Anyone can read profiles" on profiles;
create policy "Anyone can read profiles" on profiles
  for select using (true);

drop policy if exists "Users can insert own profile" on profiles;
create policy "Users can insert own profile" on profiles
  for insert with check (auth.uid() = id);

drop policy if exists "Users can update own profile" on profiles;
create policy "Users can update own profile" on profiles
  for update using (auth.uid() = id or is_admin());

-- The demo admin login has no Supabase session, so it cannot satisfy is_admin().
-- This testing policy lets the admin dashboard suspend and restore customers.
-- Remove it once every admin signs in with a real Supabase account.
drop policy if exists "Allow profile updates for admin testing" on profiles;
create policy "Allow profile updates for admin testing" on profiles
  for update using (true);

alter table reward_history enable row level security;

drop policy if exists "Anyone can read reward history" on reward_history;
create policy "Anyone can read reward history" on reward_history
  for select using (true);

drop policy if exists "Users can insert own rewards" on reward_history;
create policy "Users can insert own rewards" on reward_history
  for insert with check (true);

-- =====================================================
-- PART 4 - Seller rejection + admin policies
-- =====================================================

alter table shop_sellers
  add column if not exists is_rejected boolean default false;

drop policy if exists "Admins can view all sellers" on shop_sellers;
create policy "Admins can view all sellers" on shop_sellers
  for select using (is_admin());

drop policy if exists "Admins can update sellers" on shop_sellers;
create policy "Admins can update sellers" on shop_sellers
  for update using (is_admin()) with check (is_admin());

drop policy if exists "Admins can delete sellers" on shop_sellers;
create policy "Admins can delete sellers" on shop_sellers
  for delete using (is_admin());

drop policy if exists "Admins can manage products" on shop_products;
create policy "Admins can manage products" on shop_products
  for all using (is_admin()) with check (is_admin());

drop policy if exists "Admins can view all orders" on shop_orders;
create policy "Admins can view all orders" on shop_orders
  for select using (is_admin());

drop policy if exists "Admins can update orders" on shop_orders;
create policy "Admins can update orders" on shop_orders
  for update using (is_admin()) with check (is_admin());

-- Once real admin accounts exist, remove the public testing policy:
-- drop policy if exists "Allow updates for admin testing" on shop_sellers;

-- =====================================================
-- PART 5 - Website settings used by the admin Settings tab
-- =====================================================

create table if not exists shop_settings (
  key text primary key,
  value text,
  updated_at timestamp with time zone default now()
);

alter table shop_settings enable row level security;

drop policy if exists "Anyone can read settings" on shop_settings;
create policy "Anyone can read settings" on shop_settings
  for select using (true);

drop policy if exists "Admins can write settings" on shop_settings;
create policy "Admins can write settings" on shop_settings
  for all using (is_admin()) with check (is_admin());

-- =====================================================
-- PART 6 - Promote an account to admin
-- Uncomment, put your admin email, and run these two lines.
-- The demo login (shiki@gmail.com) keeps working regardless.
-- =====================================================

-- update profiles
--   set user_type = 'admin'
--   where id = (select id from auth.users where email = 'you@example.com');
