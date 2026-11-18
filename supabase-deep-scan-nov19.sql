-- ============================================================================
-- CONNECT-Daet.ph - database clean-up from the 19 Nov 2026 deep scan
--
-- Run in Supabase -> SQL Editor AFTER supabase-xendit.sql. Safe to run again.
-- Nothing here changes what anyone is allowed to do; it removes waste and
-- closes doors nobody uses.
--
--   1. Six duplicate indexes are dropped (each table kept one copy).
--   2. Four foreign keys get the index Postgres needs to check them quickly.
--   3. Trigger functions can no longer be called through the public API.
--   4. Row Level Security policies read the signed-in user once per query
--      instead of once per row (Supabase advisor "auth_rls_initplan").
--   5. The admin-only write policies on shop settings and delivery fees no
--      longer double up with the public read policy.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Duplicate indexes
-- ----------------------------------------------------------------------------
drop index if exists public.idx_shop_order_items_order_id;   -- = idx_shop_order_items_order
drop index if exists public.idx_shop_order_items_product_id; -- = idx_shop_order_items_product
drop index if exists public.shop_orders_checkout_id_idx;     -- = idx_shop_orders_checkout_id
drop index if exists public.idx_shop_orders_user_id;         -- = idx_shop_orders_user
drop index if exists public.idx_products_seller_id;          -- = idx_shop_products_seller_id
drop index if exists public.idx_shop_sellers_user_id;        -- = idx_shop_sellers_user

-- ----------------------------------------------------------------------------
-- 2. Unindexed foreign keys
-- ----------------------------------------------------------------------------
create index if not exists idx_shop_cart_items_product on public.shop_cart_items (product_id);
create index if not exists idx_shop_conversations_product on public.shop_conversations (product_id);
create index if not exists idx_shop_reviews_product on public.shop_reviews (product_id);
create index if not exists idx_shop_seller_earnings_order on public.shop_seller_earnings (order_id);

-- ----------------------------------------------------------------------------
-- 3. Trigger functions are not API endpoints
-- (Postgres checks EXECUTE only when a trigger is created, so the triggers
-- keep firing exactly as before.)
-- ----------------------------------------------------------------------------
do $$
declare
  v_fn record;
begin
  for v_fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', v_fn.sig);
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. auth.uid() evaluated once per query in every policy
-- ----------------------------------------------------------------------------
do $$
declare
  v_policy record;
  v_using text;
  v_check text;
  v_sql text;
begin
  for v_policy in
    select tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') ~ 'auth\.uid\(\)' or coalesce(with_check, '') ~ 'auth\.uid\(\)')
  loop
    -- Already wrapped ("SELECT auth.uid()"): leave it alone.
    continue when coalesce(v_policy.qual, '') ~* 'select auth\.uid\(\)'
               or coalesce(v_policy.with_check, '') ~* 'select auth\.uid\(\)';

    v_using := replace(v_policy.qual, 'auth.uid()', '(select auth.uid())');
    v_check := replace(v_policy.with_check, 'auth.uid()', '(select auth.uid())');

    v_sql := format('alter policy %I on public.%I', v_policy.policyname, v_policy.tablename);
    if v_using is not null then
      v_sql := v_sql || format(' using (%s)', v_using);
    end if;
    if v_check is not null then
      v_sql := v_sql || format(' with check (%s)', v_check);
    end if;

    execute v_sql;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. One permissive policy per action on settings and delivery fees
-- ----------------------------------------------------------------------------
drop policy if exists shop_settings_write_admin on public.shop_settings;
drop policy if exists shop_settings_insert_admin on public.shop_settings;
drop policy if exists shop_settings_update_admin on public.shop_settings;
drop policy if exists shop_settings_delete_admin on public.shop_settings;
create policy shop_settings_insert_admin on public.shop_settings
  for insert to authenticated with check (public.is_admin());
create policy shop_settings_update_admin on public.shop_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy shop_settings_delete_admin on public.shop_settings
  for delete to authenticated using (public.is_admin());

drop policy if exists shipping_rates_write_admin on public.shop_shipping_rates;
drop policy if exists shipping_rates_insert_admin on public.shop_shipping_rates;
drop policy if exists shipping_rates_update_admin on public.shop_shipping_rates;
drop policy if exists shipping_rates_delete_admin on public.shop_shipping_rates;
create policy shipping_rates_insert_admin on public.shop_shipping_rates
  for insert to authenticated with check (public.is_admin());
create policy shipping_rates_update_admin on public.shop_shipping_rates
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy shipping_rates_delete_admin on public.shop_shipping_rates
  for delete to authenticated using (public.is_admin());

commit;
