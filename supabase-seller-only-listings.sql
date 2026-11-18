-- ============================================================================
-- CONNECT-Daet.ph - only sellers add products and categories
--
-- Run in Supabase -> SQL Editor AFTER supabase-cart-pickup-redemption.sql.
--
-- The admin moderates the marketplace (activate / deactivate / delete
-- products and categories, approve shops) but no longer lists products or
-- creates categories. Only an approved, active seller can, and a product
-- always belongs to the seller who lists it.
-- ============================================================================

begin;

drop policy if exists shop_products_insert_approved_seller_or_admin on public.shop_products;
drop policy if exists shop_products_insert_approved_seller on public.shop_products;
create policy shop_products_insert_approved_seller
  on public.shop_products for insert
  to authenticated
  with check (public.seller_can_sell() and seller_id = public.current_seller_id());

drop policy if exists shop_categories_insert_seller_or_admin on public.shop_categories;
drop policy if exists shop_categories_insert_seller on public.shop_categories;
create policy shop_categories_insert_seller
  on public.shop_categories for insert
  to authenticated
  with check (public.seller_can_sell());

commit;
