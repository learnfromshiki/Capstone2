-- =====================================================
-- FINAL FIXES — run once in the Supabase SQL Editor
-- =====================================================
-- The demo admin login (shiki@gmail.com) is checked in the browser only, so
-- its requests reach the database as "anon". If an RLS policy requires
-- is_admin() or auth.role() = 'authenticated', that check fails and the action
-- breaks with 401 or, worse, silently changes nothing.
--
-- These are the same permissive "for testing" policies already used for
-- profiles and shop_sellers. Replace them with is_admin() policies once every
-- admin signs in with a real Supabase account.

-- 1. Website Settings → "Save Changes" returned 401.
drop policy if exists "Allow settings writes for admin testing" on shop_settings;
create policy "Allow settings writes for admin testing" on shop_settings
  for all using (true) with check (true);

-- 2. Products → Delete returned 204 but removed nothing (no DELETE policy existed).
drop policy if exists "Allow product deletes for admin testing" on shop_products;
create policy "Allow product deletes for admin testing" on shop_products
  for delete using (true);

-- 3. Remove the two rows created by the automated button test.
delete from shop_products where name = 'QA Temp Product';
delete from shop_categories where name = 'QA Temp Cat';

-- 4. Admin → Customers/Sellers → Delete returned nothing (no DELETE policies).
drop policy if exists "Allow profile deletes for admin testing" on profiles;
create policy "Allow profile deletes for admin testing" on profiles
  for delete using (true);

drop policy if exists "Allow seller deletes for admin testing" on shop_sellers;
create policy "Allow seller deletes for admin testing" on shop_sellers
  for delete using (true);

-- The login itself lives in auth.users, which the browser keys cannot reach.
-- To wipe a deleted account's login completely, run it here in the SQL editor:
-- delete from auth.users where email = 'someone@example.com';

-- Leftover row from the delete-button test (safe to ignore if absent).
delete from shop_sellers where business_name = 'ZZ Delete Probe';

-- 5. Repair a seller whose shop profile was never written at signup, so the
--    account sat under Customers. Jed's account was already repaired from the
--    app; these statements are here for reference and are safe to re-run.
insert into shop_sellers (user_id, business_name, contact_email, is_approved, is_active)
select p.id, p.full_name, p.email, false, true
from profiles p
where p.email = 'jedbuzinos@gmail.com'
  and not exists (select 1 from shop_sellers s where s.user_id = p.id);

update profiles set user_type = 'seller' where email = 'jedbuzinos@gmail.com';

-- Rename the shop once the real business name is known.
-- update shop_sellers set business_name = 'Real Shop Name'
--   where contact_email = 'jedbuzinos@gmail.com';

-- Verification: the test rows should be gone.
select name, available, stock from shop_products order by created_at desc;
select name, slug, is_active from shop_categories order by display_order asc;
