-- ============================================================================
-- CONNECT-Daet - account roles, names and email verification
-- ============================================================================
-- Run this ONCE in the Supabase SQL Editor, AFTER supabase-security-hardening.sql
-- and supabase-checkout-security.sql. It is safe to re-run.
--
-- Why this file exists (November 2026):
--
--   1. "A seller turns into a buyer after logging in."
--      profiles.user_type is pinned by the trigger
--      protect_profile_privileged_fields(): for any non-admin updating their own
--      row it reassigns new.user_type := old.user_type. That is correct for
--      stopping self-promotion to 'admin', but it also silently blocked the app
--      from recording a shop owner as 'seller' - silently, because a trigger
--      that overwrites a value does not raise an error, so the update looked
--      like it worked. Any account whose profiles row was created before the
--      shop existed (for example someone who shopped first and registered a
--      shop later) was therefore stuck as 'tourist' and every screen that read
--      user_type treated the shop owner as a customer.
--
--      Fix: allow exactly one self-service change, 'tourist' -> 'seller', and
--      only for a user who really owns a row in shop_sellers. Everything else
--      stays pinned, so 'admin', points and suspension are still unreachable
--      from the browser.
--
--   2. Sign-up now collects a first and last name instead of one "Full Name".
--      profiles gains first_name and last_name; full_name is kept and still
--      filled in, because orders, the admin lists and the dashboards display it.
--
--   3. Existing sellers are repaired and existing names are split, so the admin
--      Customers / Sellers lists are correct from the first load.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Name columns
-- ----------------------------------------------------------------------------
alter table profiles add column if not exists first_name text;
alter table profiles add column if not exists last_name  text;

-- Split any existing full_name: first word is the first name, the rest is the
-- last name. Only fills rows that have nothing yet, so later edits are kept.
update profiles
set first_name = nullif(split_part(trim(full_name), ' ', 1), ''),
    last_name  = nullif(trim(substr(trim(full_name), strpos(trim(full_name), ' ') + 1)), '')
where full_name is not null
  and trim(full_name) <> ''
  and first_name is null
  and last_name is null;

-- A single-word full_name leaves last_name equal to the first name; clear that.
update profiles
set last_name = null
where last_name is not null
  and last_name = first_name;

-- ----------------------------------------------------------------------------
-- 2. True when this user owns a shop row (used by the guard below)
-- ----------------------------------------------------------------------------
create or replace function public.user_owns_shop(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from shop_sellers where user_id = p_user_id
  );
$$;

grant execute on function public.user_owns_shop(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. The profile guard, with one allowed self-service role change
-- ----------------------------------------------------------------------------
-- A normal user may edit their name, phone and address, but not their points,
-- suspension state or login email. The only role change they may make is
-- becoming a seller, and only once they actually own a shop.
create or replace function public.protect_profile_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_may_become_seller boolean := false;
begin
  -- add_reward_points() and place_order() set this transaction-local flag
  -- before they change points; it is not exposed through the Data API.
  if coalesce(current_setting('app.allow_privileged_profile_update', true), 'false') = 'true' then
    return new;
  end if;

  if auth.uid() is not null
     and auth.uid() = old.id
     and not public.is_admin() then

    -- 'tourist' -> 'seller' is allowed for a user who owns a shop_sellers row.
    -- An admin account is never downgraded, and no other value is accepted.
    v_may_become_seller :=
      coalesce(old.user_type, 'tourist') = 'tourist'
      and new.user_type = 'seller'
      and public.user_owns_shop(old.id);

    if not v_may_become_seller then
      new.user_type := old.user_type;
    end if;

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

-- ----------------------------------------------------------------------------
-- 4. Repair every account that already owns a shop
-- ----------------------------------------------------------------------------
-- Runs here in the SQL editor, where auth.uid() is null and the guard above
-- steps aside, so these updates are applied.
update profiles p
set user_type = 'seller',
    updated_at = now()
from shop_sellers s
where s.user_id = p.id
  and coalesce(p.user_type, 'tourist') not in ('seller', 'admin');

-- A shop owner whose profiles row was never created at all.
insert into profiles (id, email, full_name, user_type, points)
select s.user_id,
       coalesce(u.email, s.contact_email),
       coalesce(nullif(trim(s.business_name), ''), 'Seller'),
       'seller',
       0
from shop_sellers s
left join auth.users u on u.id = s.user_id
where s.user_id is not null
  and not exists (select 1 from profiles p where p.id = s.user_id);

commit;

-- ============================================================================
-- Checks after running (optional):
--
--   -- every shop owner is recorded as a seller (expect 0 rows)
--   select p.id, p.email, p.user_type
--   from profiles p join shop_sellers s on s.user_id = p.id
--   where p.user_type <> 'seller';
--
--   -- the name columns are there
--   select id, email, first_name, last_name, full_name, user_type
--   from profiles order by updated_at desc nulls last limit 10;
-- ============================================================================
