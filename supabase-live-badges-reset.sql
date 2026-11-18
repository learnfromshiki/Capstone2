-- ============================================================================
-- CONNECT-Daet.ph - live notification badges and the admin "reset data" tool
--
-- Run in Supabase -> SQL Editor AFTER supabase-admin-delete-accounts.sql.
--
--   1. nav_badge_counts(audience): every number shown on a sidebar / tab /
--      header badge, worked out in one call for the signed-in person only.
--   2. Realtime is switched on for the tables those numbers come from, so a
--      new order, message or shop application updates the badges at once.
--      Row Level Security still decides which changes each person receives.
--   3. admin_reset_marketplace(): the admin's "start fresh" button. It clears
--      sales and statistics (and optionally reviews, chats and notifications)
--      but never touches accounts, shops, products, categories or settings.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Badge counts
-- ----------------------------------------------------------------------------
create or replace function public.nav_badge_counts(p_audience text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_audience text := lower(coalesce(p_audience, ''));
  v_seller uuid;
  v_unread_notifications integer;
begin
  if v_user is null then
    return '{}'::jsonb;
  end if;

  select count(*)::integer into v_unread_notifications
  from shop_notifications
  where user_id = v_user and read_at is null
    and (v_audience = '' or audience = v_audience);

  -- --------------------------------------------------------------- admin
  if v_audience = 'admin' then
    if not public.is_admin() then
      return '{}'::jsonb;
    end if;

    return jsonb_build_object(
      'notifications', v_unread_notifications,
      -- Shops waiting for a yes or no
      'pending_sellers', (
        select count(*) from shop_sellers
        where coalesce(is_approved, false) = false
          and coalesce(is_rejected, false) = false
      ),
      -- Orders nobody has finished handling yet
      'orders_to_handle', (
        select count(*) from shop_orders where status in ('pending', 'confirmed', 'processing')
      ),
      'orders_pending', (select count(*) from shop_orders where status = 'pending'),
      -- Listed products shoppers cannot buy
      'out_of_stock', (
        select count(*) from shop_products where available and coalesce(stock, 0) <= 0
      ),
      'suspended_customers', (select count(*) from profiles where coalesce(is_suspended, false))
    );
  end if;

  -- --------------------------------------------------------------- seller
  if v_audience = 'seller' then
    select id into v_seller from shop_sellers where user_id = v_user;
    if v_seller is null then
      return jsonb_build_object('notifications', v_unread_notifications);
    end if;

    return jsonb_build_object(
      'notifications', v_unread_notifications,
      -- Waiting for the shop to accept
      'orders_new', (
        select count(*) from shop_orders where seller_id = v_seller and status = 'pending'
      ),
      -- Accepted, still to pack and send (or get ready for pickup)
      'orders_to_ship', (
        select count(*) from shop_orders where seller_id = v_seller and status in ('confirmed', 'processing')
      ),
      'messages', (
        select count(*)
        from shop_messages m
        join shop_conversations c on c.id = m.conversation_id
        where c.seller_id = v_seller
          and m.sender_role <> 'seller'
          and m.read_at is null
      ),
      'out_of_stock', (
        select count(*) from shop_products
        where seller_id = v_seller and available and coalesce(stock, 0) <= 0
      ),
      'new_reviews', (
        select count(*) from shop_notifications
        where user_id = v_user and audience = 'seller' and kind = 'review' and read_at is null
      )
    );
  end if;

  -- ------------------------------------------------------------- customer
  return jsonb_build_object(
    'notifications', v_unread_notifications,
    'messages', (
      select count(*)
      from shop_messages m
      join shop_conversations c on c.id = m.conversation_id
      where c.buyer_id = v_user
        and m.sender_role <> 'buyer'
        and m.read_at is null
    ),
    -- Status changes on their orders they have not looked at yet
    'order_updates', (
      select count(*) from shop_notifications
      where user_id = v_user and audience = 'customer' and kind = 'order' and read_at is null
    ),
    -- Accepted by the shop: waiting for "Order Received"
    'orders_to_receive', (
      select count(*) from shop_orders
      where user_id = v_user and status in ('confirmed', 'processing', 'shipped')
    ),
    -- Products from delivered orders they have not rated yet
    'to_review', (
      select count(distinct i.product_id)
      from shop_orders o
      join shop_order_items i on i.order_id = o.id
      where o.user_id = v_user
        and o.status = 'delivered'
        and i.product_id is not null
        and not exists (
          select 1 from shop_reviews r where r.product_id = i.product_id and r.user_id = v_user
        )
    )
  );
end;
$$;

revoke all on function public.nav_badge_counts(text) from public, anon;
grant execute on function public.nav_badge_counts(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Realtime for the badge sources
-- ----------------------------------------------------------------------------
do $$
declare
  v_table text;
begin
  foreach v_table in array array['shop_notifications', 'shop_messages', 'shop_orders', 'shop_sellers', 'shop_products']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Reset marketplace data (admin only)
-- ----------------------------------------------------------------------------
/**
 * p_confirm must be the word RESET, so it can never run by accident.
 *
 * Always cleared (sales and statistics):
 *   - every order with its items, payments and seller earnings
 *   - reward points earned or spent in the shop (taken off each customer)
 *   - stock still held by orders that were never delivered goes back on sale
 * Optional: p_reviews, p_messages, p_notifications.
 * Never touched: accounts, shops, products, categories, delivery fees, settings.
 */
create or replace function public.admin_reset_marketplace(
  p_confirm text,
  p_reviews boolean default false,
  p_messages boolean default false,
  p_notifications boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_orders integer := 0;
  v_points_users integer := 0;
  v_reviews integer := 0;
  v_conversations integer := 0;
  v_notifications integer := 0;
  v_restocked integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can reset the marketplace.' using errcode = '42501';
  end if;

  if coalesce(p_confirm, '') <> 'RESET' then
    raise exception 'Type RESET to confirm.' using errcode = '22023';
  end if;

  -- Stock held by orders that never reached the customer goes back on sale.
  update shop_products p
  set stock = coalesce(p.stock, 0) + held.quantity,
      updated_at = now()
  from (
    select i.product_id, sum(i.quantity)::integer as quantity
    from shop_order_items i
    join shop_orders o on o.id = i.order_id
    where o.status in ('pending', 'confirmed', 'processing', 'shipped')
      and i.product_id is not null
    group by i.product_id
  ) held
  where p.id = held.product_id;
  get diagnostics v_restocked = row_count;

  -- Shop reward points: take each customer's shop earnings off (and give
  -- back what they spent), then clear those history rows.
  perform set_config('app.allow_privileged_profile_update', 'true', true);

  with shop_points as (
    select user_id, sum(points_earned)::integer as net
    from reward_history
    where subsystem_source in ('shop_purchase', 'shop_order', 'shop_redemption')
    group by user_id
  )
  update profiles pr
  set points = greatest(0, coalesce(pr.points, 0) - sp.net),
      updated_at = now()
  from shop_points sp
  where pr.id = sp.user_id and sp.net <> 0;
  get diagnostics v_points_users = row_count;

  delete from reward_history
  where subsystem_source in ('shop_purchase', 'shop_order', 'shop_redemption');

  -- Orders: items and seller earnings cascade with them.
  -- (Supabase refuses a DELETE without WHERE from the API, hence "where true".)
  delete from shop_seller_earnings where true;
  delete from shop_orders where true;
  get diagnostics v_orders = row_count;

  if p_reviews then
    delete from shop_reviews where true;
    get diagnostics v_reviews = row_count;
  end if;

  if p_messages then
    delete from shop_conversations where true; -- messages cascade
    get diagnostics v_conversations = row_count;
  end if;

  if p_notifications then
    delete from shop_notifications where true;
    get diagnostics v_notifications = row_count;
  end if;

  return jsonb_build_object(
    'orders', v_orders,
    'customers_points_adjusted', v_points_users,
    'products_restocked', v_restocked,
    'reviews', v_reviews,
    'conversations', v_conversations,
    'notifications', v_notifications
  );
end;
$$;

revoke all on function public.admin_reset_marketplace(text, boolean, boolean, boolean) from public, anon;
grant execute on function public.admin_reset_marketplace(text, boolean, boolean, boolean) to authenticated;

commit;
