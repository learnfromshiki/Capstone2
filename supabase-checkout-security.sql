-- ============================================================================
-- CONNECT-Daet — server-side checkout, order status and payment hardening
-- ============================================================================
-- Run this ONCE in the Supabase SQL Editor AFTER supabase-security-hardening.sql.
-- It is safe to re-run.
--
-- Why this file exists (problems found in the November 2026 deep scan):
--   1. Checkout ran in the browser. Any signed-in user could call the REST API
--      directly and insert an order with a made-up total (e.g. ₱1 for a ₱5,000
--      basket) or order-item prices of ₱0.01.
--   2. Every signed-in user could UPDATE the stock of ANY product (the policy
--      "shop_products_update_stock_for_checkout"), e.g. set a competitor's stock
--      to 0 so their listing shows "Sold Out".
--   3. add_reward_points() was callable by every signed-in user with any amount
--      up to 100,000 and a fresh reference id each time = unlimited free points.
--   4. A seller could cancel an order that also contained another seller's
--      products, and status changes were not validated in the database.
--   5. Buyers could not cancel their own order before the seller confirmed it.
--   6. Any signed-in user could upload any file type to any folder of the
--      product-images bucket.
--
-- What it adds:
--   • place_order()          one atomic transaction: validates the cart against
--                            live prices/stock, locks the product rows, creates
--                            one order PER SHOP (like Shopee/Lazada), reduces
--                            stock and awards reward points.
--   • update_order_status()  sellers/admins move an order through the allowed
--                            status flow; cancelling restores stock and takes
--                            back the points that order earned.
--   • cancel_my_order()      a buyer cancels their own order while it is still
--                            "pending".
--   • Locks down the old client-side write paths listed above.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Columns
-- ----------------------------------------------------------------------------
-- Which shop an order belongs to, and which checkout it came from (one checkout
-- with items from two shops produces two orders sharing one checkout_id).
alter table shop_orders add column if not exists seller_id uuid;
alter table shop_orders add column if not exists checkout_id uuid;
alter table shop_orders add column if not exists updated_at timestamptz default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'shop_orders_seller_id_fkey'
  ) then
    alter table shop_orders
      add constraint shop_orders_seller_id_fkey
      foreign key (seller_id) references shop_sellers(id) on delete set null;
  end if;
end;
$$;

create index if not exists idx_shop_orders_user_id on shop_orders(user_id);
create index if not exists idx_shop_orders_seller_id on shop_orders(seller_id);
create index if not exists idx_shop_orders_checkout_id on shop_orders(checkout_id);
create index if not exists idx_shop_order_items_order_id on shop_order_items(order_id);

-- Back-fill seller_id for existing single-shop orders so the seller dashboard
-- and reports can rely on it. Mixed-shop legacy orders keep seller_id = null.
update shop_orders o
set seller_id = x.seller_id
from (
  select oi.order_id, min(p.seller_id::text)::uuid as seller_id
  from shop_order_items oi
  join shop_products p on p.id = oi.product_id
  group by oi.order_id
  having count(distinct p.seller_id) = 1
) x
where o.id = x.order_id
  and o.seller_id is null;

-- ----------------------------------------------------------------------------
-- 1b. Field-guard triggers: do not block the SQL Editor / service role
-- ----------------------------------------------------------------------------
-- In supabase-security-hardening.sql these triggers pinned product and order
-- fields whenever the caller was "not an admin". A query run from the Supabase
-- SQL Editor (or with the service role key) has no signed-in user, so it was
-- treated as a stranger: e.g. `update shop_products set available = false`
-- silently did nothing. Requests without a user are server-side, and the anon
-- role has no UPDATE policy on these tables, so they can skip the guard.
create or replace function public.protect_product_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

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

create or replace function public.protect_order_customer_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  new.user_id := old.user_id;
  new.seller_id := old.seller_id;
  new.checkout_id := old.checkout_id;
  new.customer_name := old.customer_name;
  new.customer_email := old.customer_email;
  new.customer_phone := old.customer_phone;
  new.delivery_address := old.delivery_address;
  new.payment_method := old.payment_method;
  new.total_amount := old.total_amount;
  new.notes := old.notes;

  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Internal points helpers (not callable through the API)
-- ----------------------------------------------------------------------------
create or replace function public._grant_order_points(
  p_user uuid,
  p_points integer,
  p_reference uuid
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_points integer;
begin
  if p_user is null or p_points is null or p_points <= 0 then
    return 0;
  end if;

  if p_reference is not null and exists (
    select 1 from reward_history
    where user_id = p_user and reference_id = p_reference
  ) then
    return 0;
  end if;

  perform set_config('app.allow_privileged_profile_update', 'true', true);

  update profiles
  set points = coalesce(points, 0) + p_points,
      updated_at = now()
  where id = p_user
  returning points into v_points;

  if not found then
    return 0;
  end if;

  insert into reward_history (user_id, subsystem_source, points_earned, reference_id)
  values (p_user, 'shop_purchase', p_points, p_reference);

  return p_points;
end;
$$;

create or replace function public._revoke_order_points(
  p_user uuid,
  p_reference uuid
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_points integer;
begin
  if p_user is null or p_reference is null then
    return 0;
  end if;

  select coalesce(sum(points_earned), 0)::integer into v_points
  from reward_history
  where user_id = p_user and reference_id = p_reference;

  if v_points <= 0 then
    return 0;
  end if;

  perform set_config('app.allow_privileged_profile_update', 'true', true);

  update profiles
  set points = greatest(0, coalesce(points, 0) - v_points),
      updated_at = now()
  where id = p_user;

  delete from reward_history
  where user_id = p_user and reference_id = p_reference;

  return v_points;
end;
$$;

revoke all on function public._grant_order_points(uuid, integer, uuid) from public, anon, authenticated;
revoke all on function public._revoke_order_points(uuid, uuid) from public, anon, authenticated;

-- Shared by update_order_status() and cancel_my_order(). The caller must already
-- hold the row lock on the order.
create or replace function public._cancel_order_internal(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
  v_restored integer;
begin
  select user_id into v_user from shop_orders where id = p_order_id;

  -- Lock the product rows in a fixed order, then put the units back once.
  perform 1
  from shop_products p
  where p.id in (select product_id from shop_order_items where order_id = p_order_id)
  order by p.id
  for update;

  update shop_products p
  set stock = coalesce(p.stock, 0) + i.quantity,
      updated_at = now()
  from (
    select product_id, sum(quantity)::integer as quantity
    from shop_order_items
    where order_id = p_order_id and product_id is not null
    group by product_id
  ) i
  where p.id = i.product_id;

  get diagnostics v_restored = row_count;

  perform public._revoke_order_points(v_user, p_order_id);

  update shop_orders
  set status = 'cancelled',
      updated_at = now()
  where id = p_order_id;

  return v_restored;
end;
$$;

revoke all on function public._cancel_order_internal(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. place_order(): the only way to create an order
-- ----------------------------------------------------------------------------
-- p_items: [{"product_id": "<uuid>", "quantity": 2}, ...]
-- Returns: {"checkout_id": uuid, "total": numeric, "points": int,
--           "orders": [{"id", "seller_id", "total", "points"}, ...]}
create or replace function public.place_order(
  p_items jsonb,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_delivery_address text,
  p_payment_method text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_checkout uuid := gen_random_uuid();
  v_name text := trim(coalesce(p_customer_name, ''));
  v_email text := lower(trim(coalesce(p_customer_email, '')));
  v_phone text := trim(coalesce(p_customer_phone, ''));
  v_address text := trim(coalesce(p_delivery_address, ''));
  v_payment text := lower(trim(coalesce(p_payment_method, '')));
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
  v_lines jsonb;
  v_line record;
  v_product record;
  v_group record;
  v_order_id uuid;
  v_order_total numeric(12,2);
  v_order_points integer;
  v_orders jsonb := '[]'::jsonb;
  v_grand_total numeric(12,2) := 0;
  v_total_points integer := 0;
begin
  if v_user is null then
    raise exception 'Please sign in to place an order.' using errcode = '28000';
  end if;

  if not public.account_is_active() then
    raise exception 'This account has been suspended. Please contact CONNECT-Daet support.'
      using errcode = '42501';
  end if;

  -- Customer details --------------------------------------------------------
  if length(v_name) = 0 or length(v_name) > 120 then
    raise exception 'Please enter your full name (up to 120 characters).' using errcode = '22023';
  end if;

  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' or length(v_email) > 254 then
    raise exception 'Please enter a valid email address.' using errcode = '22023';
  end if;

  if length(regexp_replace(v_phone, '\D', '', 'g')) < 7 or length(v_phone) > 30 then
    raise exception 'Please enter a valid phone number.' using errcode = '22023';
  end if;

  if length(v_address) < 5 or length(v_address) > 500 then
    raise exception 'Please enter your complete delivery address.' using errcode = '22023';
  end if;

  if v_payment not in ('gcash', 'cod', 'bank') then
    raise exception 'Please choose a valid payment method.' using errcode = '22023';
  end if;

  if v_notes is not null and length(v_notes) > 1000 then
    raise exception 'Order notes must be 1,000 characters or less.' using errcode = '22023';
  end if;

  -- Cart lines ----------------------------------------------------------------
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Your cart is empty.' using errcode = '22023';
  end if;

  if jsonb_array_length(p_items) > 50 then
    raise exception 'A single checkout can contain at most 50 different products.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) e
    where jsonb_typeof(e) <> 'object'
       or coalesce(e->>'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or coalesce(e->>'quantity', '') !~ '^[0-9]{1,4}$'
       or (e->>'quantity')::integer < 1
  ) then
    raise exception 'One of the items in your cart is invalid. Please remove it and try again.'
      using errcode = '22023';
  end if;

  -- Merge duplicate lines for the same product.
  select jsonb_agg(jsonb_build_object('product_id', product_id, 'quantity', quantity) order by product_id)
  into v_lines
  from (
    select (e->>'product_id')::uuid as product_id,
           sum((e->>'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) e
    group by 1
  ) merged;

  -- Lock every product (in a fixed order to avoid deadlocks) and validate it.
  for v_line in
    select * from jsonb_to_recordset(v_lines) as n(product_id uuid, quantity integer)
    order by product_id
  loop
    select p.id, p.name, p.price, coalesce(p.stock, 0) as stock, p.available, p.seller_id
    into v_product
    from shop_products p
    where p.id = v_line.product_id
    for update;

    if not found then
      raise exception 'One of the products in your cart is no longer available. Please remove it and try again.'
        using errcode = 'P0002';
    end if;

    if v_product.available is distinct from true then
      raise exception '% is no longer available. Please remove it from your cart.', v_product.name
        using errcode = 'P0001';
    end if;

    if v_product.seller_id is not null and not public.seller_is_public(v_product.seller_id) then
      raise exception '% is no longer sold by an active shop. Please remove it from your cart.', v_product.name
        using errcode = 'P0001';
    end if;

    if v_line.quantity > 9999 then
      raise exception 'The quantity for % is too large.', v_product.name using errcode = '22023';
    end if;

    if v_product.price is null or v_product.price <= 0 then
      raise exception '% has an invalid price. Please contact the seller.', v_product.name
        using errcode = 'P0001';
    end if;

    if v_product.stock < v_line.quantity then
      raise exception '% has insufficient stock. Available: %, requested: %.',
        v_product.name, v_product.stock, v_line.quantity
        using errcode = 'P0001';
    end if;
  end loop;

  -- One order per shop ----------------------------------------------------------
  for v_group in
    select p.seller_id,
           sum(p.price * n.quantity)::numeric(12,2) as total
    from jsonb_to_recordset(v_lines) as n(product_id uuid, quantity integer)
    join shop_products p on p.id = n.product_id
    group by p.seller_id
    order by p.seller_id nulls last
  loop
    v_order_total := v_group.total;

    insert into shop_orders (
      user_id, seller_id, checkout_id,
      customer_name, customer_email, customer_phone, delivery_address,
      payment_method, total_amount, status, notes, created_at, updated_at
    ) values (
      v_user, v_group.seller_id, v_checkout,
      v_name, v_email, v_phone, v_address,
      v_payment, v_order_total, 'pending', v_notes, now(), now()
    )
    returning id into v_order_id;

    insert into shop_order_items (order_id, product_id, product_name, quantity, price)
    select v_order_id, p.id, p.name, n.quantity, p.price
    from jsonb_to_recordset(v_lines) as n(product_id uuid, quantity integer)
    join shop_products p on p.id = n.product_id
    where p.seller_id is not distinct from v_group.seller_id
    order by p.name;

    update shop_products p
    set stock = p.stock - n.quantity,
        updated_at = now()
    from jsonb_to_recordset(v_lines) as n(product_id uuid, quantity integer)
    where p.id = n.product_id
      and p.seller_id is not distinct from v_group.seller_id;

    -- 10 points for every full ₱100 of this shop order.
    v_order_points := public._grant_order_points(
      v_user,
      (floor(v_order_total / 100) * 10)::integer,
      v_order_id
    );

    v_grand_total := v_grand_total + v_order_total;
    v_total_points := v_total_points + v_order_points;
    v_orders := v_orders || jsonb_build_object(
      'id', v_order_id,
      'seller_id', v_group.seller_id,
      'total', v_order_total,
      'points', v_order_points
    );
  end loop;

  return jsonb_build_object(
    'checkout_id', v_checkout,
    'total', v_grand_total,
    'points', v_total_points,
    'orders', v_orders
  );
end;
$$;

revoke all on function public.place_order(jsonb, text, text, text, text, text, text) from public, anon;
grant execute on function public.place_order(jsonb, text, text, text, text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. update_order_status(): sellers and admins
-- ----------------------------------------------------------------------------
create or replace function public.update_order_status(p_order_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_order record;
  v_is_admin boolean := public.is_admin();
  v_status text := lower(trim(coalesce(p_status, '')));
  v_allowed text[];
  v_restored integer := 0;
  v_foreign_items boolean;
begin
  if v_user is null then
    raise exception 'Please sign in again.' using errcode = '28000';
  end if;

  if v_status not in ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled') then
    raise exception 'Unknown order status.' using errcode = '22023';
  end if;

  select id, status, user_id into v_order
  from shop_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;

  if not v_is_admin then
    if not public.seller_can_sell() or not public.seller_owns_order(p_order_id) then
      raise exception 'You can only update orders that contain your products.' using errcode = '42501';
    end if;

    select exists (
      select 1
      from shop_order_items oi
      left join shop_products p on p.id = oi.product_id
      where oi.order_id = p_order_id
        and p.seller_id is distinct from public.current_seller_id()
    ) into v_foreign_items;

    if v_foreign_items and v_status = 'cancelled' then
      raise exception 'This order also contains items from other shops. Please ask the CONNECT-Daet admin to cancel it.'
        using errcode = '42501';
    end if;
  end if;

  if v_order.status = v_status then
    return jsonb_build_object('status', v_status, 'restored_items', 0);
  end if;

  v_allowed := case v_order.status
    when 'pending' then array['confirmed', 'processing', 'cancelled']
    when 'confirmed' then array['processing', 'shipped', 'cancelled']
    when 'processing' then array['shipped', 'cancelled']
    when 'shipped' then array['delivered']
    else array[]::text[]
  end;

  if not (v_status = any(v_allowed)) then
    if v_order.status = 'cancelled' then
      raise exception 'A cancelled order cannot be reopened. Create a new order instead.' using errcode = 'P0001';
    elsif v_order.status = 'delivered' then
      raise exception 'A delivered order cannot be changed.' using errcode = 'P0001';
    end if;
    raise exception 'An order cannot move from % to %.', v_order.status, v_status using errcode = 'P0001';
  end if;

  if v_status = 'cancelled' then
    v_restored := public._cancel_order_internal(p_order_id);
  else
    update shop_orders
    set status = v_status,
        updated_at = now()
    where id = p_order_id;
  end if;

  return jsonb_build_object('status', v_status, 'restored_items', v_restored);
end;
$$;

revoke all on function public.update_order_status(uuid, text) from public, anon;
grant execute on function public.update_order_status(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. cancel_my_order(): buyers, while the order is still pending
-- ----------------------------------------------------------------------------
create or replace function public.cancel_my_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_order record;
  v_restored integer;
begin
  if v_user is null then
    raise exception 'Please sign in again.' using errcode = '28000';
  end if;

  select id, status, user_id into v_order
  from shop_orders
  where id = p_order_id
  for update;

  if not found or v_order.user_id is distinct from v_user then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;

  if v_order.status = 'cancelled' then
    return jsonb_build_object('status', 'cancelled', 'restored_items', 0);
  end if;

  if v_order.status <> 'pending' then
    raise exception 'The shop has already started preparing this order, so it can no longer be cancelled online. Please contact the shop.'
      using errcode = 'P0001';
  end if;

  v_restored := public._cancel_order_internal(p_order_id);

  return jsonb_build_object('status', 'cancelled', 'restored_items', v_restored);
end;
$$;

revoke all on function public.cancel_my_order(uuid) from public, anon;
grant execute on function public.cancel_my_order(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Close the old client-side write paths
-- ----------------------------------------------------------------------------
-- Stock can now only change through the functions above, the owning seller, or
-- an admin.
drop policy if exists "shop_products_update_stock_for_checkout" on shop_products;

-- Orders and order items are created only by place_order().
drop policy if exists "shop_orders_insert_own_active_account" on shop_orders;
drop policy if exists "shop_order_items_insert_own_pending_order" on shop_order_items;

-- Order status changes go through update_order_status(); only admins may edit
-- order rows directly (e.g. fixing a typo in an address).
drop policy if exists "shop_orders_update_seller_or_admin" on shop_orders;
drop policy if exists "shop_orders_update_admin" on shop_orders;
create policy "shop_orders_update_admin"
  on shop_orders for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "shop_orders_delete_own_pending_or_admin" on shop_orders;
drop policy if exists "shop_orders_delete_admin" on shop_orders;
create policy "shop_orders_delete_admin"
  on shop_orders for delete
  to authenticated
  using (public.is_admin());

drop policy if exists "shop_order_items_delete_own_pending_or_admin" on shop_order_items;
drop policy if exists "shop_order_items_delete_admin" on shop_order_items;
create policy "shop_order_items_delete_admin"
  on shop_order_items for delete
  to authenticated
  using (public.is_admin());

-- Sellers can now see orders for their shop through seller_id too.
drop policy if exists "shop_orders_select_buyer_seller_admin" on shop_orders;
create policy "shop_orders_select_buyer_seller_admin"
  on shop_orders for select
  to authenticated
  using (
    public.is_admin()
    or user_id = auth.uid()
    or (seller_id is not null and seller_id = public.current_seller_id())
    or public.seller_owns_order(id)
  );

-- Points are only granted inside place_order(); clients may no longer mint them.
do $$
begin
  if exists (
    select 1 from pg_proc
    where proname = 'add_reward_points'
      and pronamespace = 'public'::regnamespace
  ) then
    execute 'revoke all on function public.add_reward_points(integer, text, uuid) from public, anon, authenticated';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. Product image storage: images only, 5 MB, uploads into your own folder
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    update storage.buckets
    set file_size_limit = 5242880,
        allowed_mime_types = array['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    where id = 'product-images';

    execute 'drop policy if exists "Authenticated users can upload product images" on storage.objects';
    execute 'drop policy if exists "product_images_insert_own_folder" on storage.objects';
    execute $policy$
      create policy "product_images_insert_own_folder"
      on storage.objects for insert
      to authenticated
      with check (
        bucket_id = 'product-images'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
    $policy$;
  end if;
end;
$$;

commit;

-- ============================================================================
-- Quick check after running (optional):
--   select proname from pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname in ('place_order', 'update_order_status', 'cancel_my_order');
-- ============================================================================
