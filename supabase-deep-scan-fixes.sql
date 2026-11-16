-- Deep scan fixes, 17 November 2026. Run once in the Supabase SQL editor.
-- Safe to run again.

-- 1. Deleting a customer or seller -----------------------------------------
-- The admin page used to delete only the profile row. The login itself
-- survived, so the person could still sign in, but with no profile every
-- checkout failed with "This account has been suspended". These functions
-- delete the login too (the profile, shop, chats and notifications follow
-- through ON DELETE CASCADE). Orders are kept: shop_orders.user_id has no
-- foreign key, so sales records stay intact.

create or replace function public.admin_delete_account(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can delete accounts.' using errcode = '42501';
  end if;

  if p_user_id is null or p_user_id = auth.uid() then
    raise exception 'You cannot delete your own account here.' using errcode = '22023';
  end if;

  if exists (select 1 from profiles where id = p_user_id and user_type = 'admin') then
    raise exception 'Admin accounts cannot be deleted from this page.' using errcode = '42501';
  end if;

  -- A product that appears in past orders cannot be deleted (the order keeps
  -- pointing at it), so it is hidden instead. Without this, deleting the shop
  -- left those products live in the catalog with no owner.
  delete from shop_products p
  where p.seller_id in (select id from shop_sellers where user_id = p_user_id)
    and not exists (select 1 from shop_order_items i where i.product_id = p.id);

  update shop_products
  set available = false, updated_at = now()
  where seller_id in (select id from shop_sellers where user_id = p_user_id);

  delete from auth.users where id = p_user_id;
end;
$$;

create or replace function public.admin_delete_seller(p_seller_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can delete shops.' using errcode = '42501';
  end if;

  select user_id into v_user from shop_sellers where id = p_seller_id;
  if not found then
    raise exception 'Shop not found.' using errcode = 'P0002';
  end if;

  delete from shop_products p
  where p.seller_id = p_seller_id
    and not exists (select 1 from shop_order_items i where i.product_id = p.id);

  update shop_products
  set available = false, updated_at = now()
  where seller_id = p_seller_id;

  if v_user is not null
     and v_user is distinct from auth.uid()
     and not exists (select 1 from profiles where id = v_user and user_type = 'admin') then
    delete from auth.users where id = v_user;   -- removes the shop by cascade
  else
    delete from shop_sellers where id = p_seller_id;
  end if;
end;
$$;

revoke all on function public.admin_delete_account(uuid) from public, anon;
revoke all on function public.admin_delete_seller(uuid) from public, anon;
grant execute on function public.admin_delete_account(uuid) to authenticated;
grant execute on function public.admin_delete_seller(uuid) to authenticated;

-- 2. Repair data left behind by the old behaviour ---------------------------
-- Logins whose profile was deleted get a fresh profile, so they can check
-- out again.
insert into profiles (id, full_name, email)
select u.id, coalesce(u.raw_user_meta_data->>'full_name', u.email), u.email
from auth.users u
where not exists (select 1 from profiles p where p.id = u.id);

-- An order delivered before the earnings trigger existed still shows its
-- earning as pending.
update shop_seller_earnings e
set status = 'paid', paid_at = coalesce(e.paid_at, o.updated_at)
from shop_orders o
where o.id = e.order_id and o.status = 'delivered' and e.status = 'pending';

update shop_seller_earnings e
set status = 'cancelled'
from shop_orders o
where o.id = e.order_id and o.status = 'cancelled' and e.status = 'pending';

-- 3. seller_dashboard_stats multiplied every total -------------------------
-- It joined products x order items x earnings, so one seller with 3 products
-- and 4 earnings rows reported 12x the real sales. Rebuilt from independent
-- sub-totals.
create or replace view public.seller_dashboard_stats
with (security_invoker = true) as
select
  s.id as seller_id,
  s.business_name,
  (select count(*) from shop_products p where p.seller_id = s.id) as total_products,
  (select count(*) from shop_products p where p.seller_id = s.id and p.available) as active_products,
  (select count(*) from shop_orders o where o.seller_id = s.id) as total_orders,
  coalesce((select sum(e.product_sale_amount) from shop_seller_earnings e
            where e.seller_id = s.id and e.status <> 'cancelled'), 0) as total_sales,
  coalesce((select sum(e.seller_earning) from shop_seller_earnings e
            where e.seller_id = s.id and e.status <> 'cancelled'), 0) as total_earnings,
  coalesce((select sum(e.seller_earning) from shop_seller_earnings e
            where e.seller_id = s.id and e.status = 'pending'), 0) as pending_earnings,
  coalesce((select sum(e.seller_earning) from shop_seller_earnings e
            where e.seller_id = s.id and e.status = 'paid'), 0) as paid_earnings
from shop_sellers s;
