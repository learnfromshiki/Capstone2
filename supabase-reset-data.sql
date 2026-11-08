-- =====================================================
-- CONNECT-Daet.ph - START OVER (wipe shop data)
-- Run this in the Supabase SQL Editor.
--
-- DELETES PERMANENTLY:
--   - every product, order, order item, review, seller earning
--   - every seller application
--   - every customer profile, reward history and LOGIN ACCOUNT
--
-- KEEPS:
--   - the admin account named below (and its profile)
--   - shop categories
--   - shop settings
--
-- This cannot be undone. Take a backup first if unsure
-- (Supabase: Database -> Backups).
-- =====================================================

-- >>> EDIT THIS: the one login account to keep <<<
-- The demo admin login (shiki@gmail.com) is client-side only and
-- needs no auth account; keep a real admin email here if you have one.

begin;

-- 1. Transaction data (order items and reviews also cascade from products,
--    but deleting them explicitly keeps this readable)
delete from shop_seller_earnings;
delete from shop_order_items;
delete from shop_orders;
delete from shop_reviews;

-- 2. Products
delete from shop_products;

-- 3. Sellers
delete from shop_sellers;

-- 4. Reward history
delete from reward_history;

-- 5. Profiles, keeping administrators
delete from profiles
where coalesce(user_type, '') <> 'admin';

-- 6. Login accounts, keeping the admin email above
delete from auth.users
where lower(email) is distinct from 'shiki@gmail.com';

commit;

-- =====================================================
-- Verify: every count should be 0 except categories/settings
-- =====================================================
select 'products'         as table_name, count(*) as rows from shop_products
union all select 'orders',        count(*) from shop_orders
union all select 'order items',   count(*) from shop_order_items
union all select 'reviews',       count(*) from shop_reviews
union all select 'sellers',       count(*) from shop_sellers
union all select 'profiles',      count(*) from profiles
union all select 'categories',    count(*) from shop_categories
union all select 'settings',      count(*) from shop_settings
order by table_name;
