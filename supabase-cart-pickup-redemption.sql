-- ============================================================================
-- CONNECT-Daet.ph - persistent cart, store pickup and reward points redemption
--
-- Run in Supabase -> SQL Editor AFTER supabase-points-on-delivery.sql.
--
-- Closes the prototype gaps listed in the Final Defense evaluation (Table 8):
--
--   1. The cart is saved in the database (shop_cart_items), not only in the
--      browser, so it follows the customer to any device.
--   2. Orders can be picked up at the shop instead of delivered
--      (shop_orders.fulfillment_method). Pickup has no delivery fee.
--   3. Reward points can be redeemed at checkout: 1 point = PHP 1 off the
--      goods, up to 50% of each shop's goods subtotal. Redeemed points are
--      deducted inside the same place_order() transaction that creates the
--      order, its items and the stock deduction, and are returned
--      automatically if the order is cancelled.
--
-- Everything still happens in one database transaction per checkout, and
-- points are still EARNED only when an order is delivered / picked up.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Persistent cart
-- ----------------------------------------------------------------------------
create table if not exists public.shop_cart_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  line_id text not null check (length(line_id) between 1 and 300),
  product_id uuid not null references public.shop_products(id) on delete cascade,
  quantity integer not null check (quantity between 1 and 9999),
  options jsonb not null default '{}'::jsonb,
  -- What the storefront shows for the line (name, price, image...). Prices
  -- here are only a display snapshot: place_order() always re-prices.
  item jsonb not null default '{}'::jsonb,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, line_id)
);

create index if not exists shop_cart_items_user_idx on public.shop_cart_items (user_id, position);

alter table public.shop_cart_items enable row level security;

drop policy if exists "Customers read their own cart" on public.shop_cart_items;
create policy "Customers read their own cart"
  on public.shop_cart_items for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Customers delete their own cart lines" on public.shop_cart_items;
create policy "Customers delete their own cart lines"
  on public.shop_cart_items for delete
  to authenticated
  using (user_id = auth.uid());

-- Writes go through save_my_cart(), which validates every line.
revoke insert, update on public.shop_cart_items from anon, authenticated;
grant select, delete on public.shop_cart_items to authenticated;

/**
 * Replace the signed-in customer's whole cart in one transaction.
 * p_items: [{ line_id, product_id, quantity, options, item }]
 * Lines for products that no longer exist are dropped silently.
 */
create or replace function public.save_my_cart(p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_saved integer;
begin
  if v_user is null then
    raise exception 'Please sign in to save your cart.' using errcode = '28000';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Invalid cart.' using errcode = '22023';
  end if;

  if jsonb_array_length(p_items) > 100 then
    raise exception 'A cart can hold at most 100 different items.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) e
    where jsonb_typeof(e) <> 'object'
       or coalesce(e->>'line_id', '') = ''
       or length(e->>'line_id') > 300
       or coalesce(e->>'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or coalesce(e->>'quantity', '') !~ '^[0-9]{1,4}$'
       or (e->>'quantity')::integer < 1
       or (e ? 'options' and jsonb_typeof(e->'options') not in ('object', 'null'))
       or (e ? 'item' and jsonb_typeof(e->'item') not in ('object', 'null'))
       or length(coalesce(e->'item', '{}'::jsonb)::text) > 8000
  ) then
    raise exception 'One of the items in your cart is invalid.' using errcode = '22023';
  end if;

  delete from shop_cart_items where user_id = v_user;

  insert into shop_cart_items (user_id, line_id, product_id, quantity, options, item, position, updated_at)
  select distinct on (e.value->>'line_id')
         v_user,
         e.value->>'line_id',
         (e.value->>'product_id')::uuid,
         (e.value->>'quantity')::integer,
         coalesce(nullif(e.value->'options', 'null'::jsonb), '{}'::jsonb),
         coalesce(nullif(e.value->'item', 'null'::jsonb), '{}'::jsonb),
         e.ordinality::integer,
         now()
  from jsonb_array_elements(p_items) with ordinality e
  where exists (select 1 from shop_products p where p.id = (e.value->>'product_id')::uuid)
  order by e.value->>'line_id', e.ordinality;

  get diagnostics v_saved = row_count;
  return v_saved;
end;
$$;

revoke all on function public.save_my_cart(jsonb) from public, anon;
grant execute on function public.save_my_cart(jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Order columns for pickup and redeemed points
-- ----------------------------------------------------------------------------
alter table public.shop_orders
  add column if not exists fulfillment_method text not null default 'delivery',
  add column if not exists points_redeemed integer not null default 0,
  add column if not exists points_discount numeric(12,2) not null default 0;

alter table public.shop_orders drop constraint if exists shop_orders_fulfillment_method_check;
alter table public.shop_orders
  add constraint shop_orders_fulfillment_method_check
  check (fulfillment_method in ('delivery', 'pickup'));

alter table public.shop_orders drop constraint if exists shop_orders_points_redeemed_check;
alter table public.shop_orders
  add constraint shop_orders_points_redeemed_check
  check (points_redeemed >= 0 and points_discount >= 0);

-- Customers and sellers cannot rewrite these after the order is placed.
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
  new.shipping_fee := old.shipping_fee;
  new.notes := old.notes;
  new.payment_status := old.payment_status;
  new.paymongo_session_id := old.paymongo_session_id;
  new.paid_at := old.paid_at;
  new.fulfillment_method := old.fulfillment_method;
  new.points_redeemed := old.points_redeemed;
  new.points_discount := old.points_discount;

  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Points ledger helpers
--
-- reward_history rows for an order:
--   subsystem_source = 'shop_purchase'    points_earned > 0  (earned on delivery)
--   subsystem_source = 'shop_redemption'  points_earned < 0  (spent at checkout)
-- ----------------------------------------------------------------------------

-- One order may now have two ledger rows (spent at checkout, earned on
-- delivery), so uniqueness is per source instead of per order.
drop index if exists public.reward_history_reference_unique;
create unique index if not exists reward_history_reference_source_unique
  on public.reward_history (user_id, reference_id, subsystem_source)
  where reference_id is not null;

-- Earning is idempotent per order, and a redemption row must not count as
-- "already earned".
create or replace function public._grant_order_points(p_user uuid, p_points integer, p_reference uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_user is null or p_points is null or p_points <= 0 then
    return 0;
  end if;

  if p_reference is not null and exists (
    select 1 from reward_history
    where user_id = p_user and reference_id = p_reference and points_earned > 0
  ) then
    return 0;
  end if;

  perform set_config('app.allow_privileged_profile_update', 'true', true);

  update profiles
  set points = coalesce(points, 0) + p_points,
      updated_at = now()
  where id = p_user;

  if not found then
    return 0;
  end if;

  insert into reward_history (user_id, subsystem_source, points_earned, reference_id)
  values (p_user, 'shop_purchase', p_points, p_reference);

  return p_points;
end;
$$;

-- On cancellation: take back what the order earned AND give back what the
-- customer spent on it.
create or replace function public._revoke_order_points(p_user uuid, p_reference uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_earned integer;
  v_spent integer;
begin
  if p_user is null or p_reference is null then
    return 0;
  end if;

  select coalesce(sum(points_earned) filter (where points_earned > 0), 0)::integer,
         coalesce(-sum(points_earned) filter (where points_earned < 0), 0)::integer
  into v_earned, v_spent
  from reward_history
  where user_id = p_user and reference_id = p_reference;

  if v_earned = 0 and v_spent = 0 then
    return 0;
  end if;

  perform set_config('app.allow_privileged_profile_update', 'true', true);

  update profiles
  set points = greatest(0, coalesce(points, 0) - v_earned + v_spent),
      updated_at = now()
  where id = p_user;

  delete from reward_history
  where user_id = p_user and reference_id = p_reference;

  return v_earned;
end;
$$;

revoke all on function public._grant_order_points(uuid, integer, uuid) from public, anon, authenticated;
revoke all on function public._revoke_order_points(uuid, uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. place_order: delivery or pickup, with optional points redemption
-- ----------------------------------------------------------------------------
drop function if exists public.place_order(jsonb, text, text, text, text, text, text, text, text);

create or replace function public.place_order(
  p_items jsonb,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_delivery_address text,
  p_payment_method text,
  p_notes text default null,
  p_province text default null,
  p_city text default null,
  p_fulfillment text default 'delivery',
  p_redeem_points integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- 1 point = PHP 1; points may pay for at most this share of a shop's goods.
  c_max_redeem_share constant numeric := 0.5;
  -- PayMongo does not accept very small online payments.
  c_paymongo_minimum constant numeric := 20;

  v_user uuid := auth.uid();
  v_checkout uuid := gen_random_uuid();
  v_name text := trim(coalesce(p_customer_name, ''));
  v_email text := lower(trim(coalesce(p_customer_email, '')));
  v_phone text := trim(coalesce(p_customer_phone, ''));
  v_address text := trim(coalesce(p_delivery_address, ''));
  v_payment text := lower(trim(coalesce(p_payment_method, '')));
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
  v_fulfillment text := lower(trim(coalesce(p_fulfillment, 'delivery')));
  v_redeem_wanted integer := greatest(coalesce(p_redeem_points, 0), 0);
  v_balance integer := 0;
  v_redeem_left integer := 0;
  v_order_redeem integer;
  v_order_address text;
  v_shop record;
  v_lines jsonb;
  v_line record;
  v_product record;
  v_group record;
  v_order_id uuid;
  v_subtotal numeric(12,2);
  v_shipping numeric(10,2);
  v_order_total numeric(12,2);
  v_order_points integer;
  v_orders jsonb := '[]'::jsonb;
  v_grand_total numeric(12,2) := 0;
  v_grand_shipping numeric(12,2) := 0;
  v_total_points integer := 0;
  v_total_redeemed integer := 0;
begin
  if v_user is null then
    raise exception 'Please sign in to place an order.' using errcode = '28000';
  end if;

  if not public.account_is_active() then
    raise exception 'This account has been suspended. Please contact CONNECT-Daet support.'
      using errcode = '42501';
  end if;

  if v_fulfillment not in ('delivery', 'pickup') then
    raise exception 'Please choose delivery or store pickup.' using errcode = '22023';
  end if;

  if length(v_name) = 0 or length(v_name) > 120 then
    raise exception 'Please enter your full name (up to 120 characters).' using errcode = '22023';
  end if;

  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' or length(v_email) > 254 then
    raise exception 'Please enter a valid email address.' using errcode = '22023';
  end if;

  if length(regexp_replace(v_phone, '\D', '', 'g')) < 7 or length(v_phone) > 30 then
    raise exception 'Please enter a valid phone number.' using errcode = '22023';
  end if;

  if v_fulfillment = 'delivery' and (length(v_address) < 5 or length(v_address) > 500) then
    raise exception 'Please enter your complete delivery address.' using errcode = '22023';
  end if;

  if v_payment not in ('gcash', 'cod', 'bank', 'paymongo') then
    raise exception 'Please choose a valid payment method.' using errcode = '22023';
  end if;

  if v_notes is not null and length(v_notes) > 1000 then
    raise exception 'Order notes must be 1,000 characters or less.' using errcode = '22023';
  end if;

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
       or (e ? 'options' and jsonb_typeof(e->'options') not in ('object', 'null'))
  ) then
    raise exception 'One of the items in your cart is invalid. Please remove it and try again.'
      using errcode = '22023';
  end if;

  -- Points to spend: never more than the customer has. The profile row is
  -- locked so two checkouts cannot spend the same points.
  if v_redeem_wanted > 0 then
    select coalesce(points, 0) into v_balance
    from profiles
    where id = v_user
    for update;

    if coalesce(v_balance, 0) < v_redeem_wanted then
      raise exception 'You only have % reward points.', coalesce(v_balance, 0) using errcode = 'P0001';
    end if;

    v_redeem_left := v_redeem_wanted;
  end if;

  select jsonb_agg(
           jsonb_build_object('product_id', product_id, 'quantity', quantity, 'options', options)
           order by product_id, options::text
         )
  into v_lines
  from (
    select (e->>'product_id')::uuid as product_id,
           coalesce(nullif(e->'options', 'null'::jsonb), '{}'::jsonb) as options,
           sum((e->>'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) e
    group by 1, 2
  ) merged;

  for v_line in
    select * from jsonb_to_recordset(v_lines) as n(product_id uuid, quantity integer, options jsonb)
    order by product_id
  loop
    select p.id, p.name, p.price, coalesce(p.stock, 0) as stock, p.available, p.seller_id,
           coalesce(p.options, '[]'::jsonb) as offered
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

    for v_group in
      select g->>'name' as group_name, g->'values' as allowed
      from jsonb_array_elements(v_product.offered) g
      where coalesce(g->>'name', '') <> ''
    loop
      if coalesce(v_line.options->>v_group.group_name, '') = '' then
        raise exception 'Please choose the % for %.', lower(v_group.group_name), v_product.name
          using errcode = '22023';
      end if;

      if not exists (
        select 1 from jsonb_array_elements_text(v_group.allowed) a
        where a = v_line.options->>v_group.group_name
      ) then
        raise exception '% is not an option for % on %.',
          v_line.options->>v_group.group_name, lower(v_group.group_name), v_product.name
          using errcode = '22023';
      end if;
    end loop;
  end loop;

  -- One order per shop. Delivery: each shop charges its own fee.
  -- Pickup: no fee, and the order carries that shop's pickup address.
  for v_group in
    select p.seller_id,
           sum(p.price * n.quantity)::numeric(12,2) as subtotal
    from jsonb_to_recordset(v_lines) as n(product_id uuid, quantity integer, options jsonb)
    join shop_products p on p.id = n.product_id
    group by p.seller_id
    order by p.seller_id nulls last
  loop
    v_subtotal := v_group.subtotal;

    if v_fulfillment = 'pickup' then
      v_shipping := 0;
      select s.business_name, s.address into v_shop
      from shop_sellers s where s.id = v_group.seller_id;

      v_order_address := left(
        'STORE PICKUP - ' ||
        coalesce(nullif(btrim(v_shop.business_name), ''), 'CONNECT-Daet') ||
        coalesce(': ' || nullif(btrim(v_shop.address), ''), ' (the shop will message you the pickup point)'),
        500
      );
    else
      v_shipping := public.shipping_fee_for(p_province, p_city, v_subtotal);
      v_order_address := v_address;
    end if;

    -- Points pay for goods only, up to half of this shop's goods.
    v_order_redeem := least(v_redeem_left, floor(v_subtotal * c_max_redeem_share)::integer);
    v_redeem_left := v_redeem_left - v_order_redeem;

    v_order_total := v_subtotal + v_shipping - v_order_redeem;

    insert into shop_orders (
      user_id, seller_id, checkout_id,
      customer_name, customer_email, customer_phone, delivery_address,
      payment_method, total_amount, shipping_fee, status, notes,
      fulfillment_method, points_redeemed, points_discount,
      created_at, updated_at
    ) values (
      v_user, v_group.seller_id, v_checkout,
      v_name, v_email, v_phone, v_order_address,
      v_payment, v_order_total, v_shipping, 'pending', v_notes,
      v_fulfillment, v_order_redeem, v_order_redeem,
      now(), now()
    )
    returning id into v_order_id;

    insert into shop_order_items (order_id, product_id, product_name, quantity, price, options)
    select v_order_id, p.id, p.name, n.quantity, p.price, nullif(n.options, '{}'::jsonb)
    from jsonb_to_recordset(v_lines) as n(product_id uuid, quantity integer, options jsonb)
    join shop_products p on p.id = n.product_id
    where p.seller_id is not distinct from v_group.seller_id
    order by p.name;

    update shop_products p
    set stock = p.stock - totals.quantity,
        updated_at = now()
    from (
      select n.product_id, sum(n.quantity)::integer as quantity
      from jsonb_to_recordset(v_lines) as n(product_id uuid, quantity integer, options jsonb)
      group by n.product_id
    ) totals
    where p.id = totals.product_id
      and p.seller_id is not distinct from v_group.seller_id;

    -- Spend the points against this order, in the same transaction.
    if v_order_redeem > 0 then
      perform set_config('app.allow_privileged_profile_update', 'true', true);

      update profiles
      set points = coalesce(points, 0) - v_order_redeem,
          updated_at = now()
      where id = v_user;

      insert into reward_history (user_id, subsystem_source, points_earned, reference_id)
      values (v_user, 'shop_redemption', -v_order_redeem, v_order_id);
    end if;

    -- Earned on what is paid for the goods (after points), never on the
    -- delivery fee, and only once the order is delivered / picked up. Must
    -- match grant_points_on_delivery().
    v_order_points := (floor(greatest(v_order_total - v_shipping, 0) / 100) * 10)::integer;

    v_grand_total := v_grand_total + v_order_total;
    v_grand_shipping := v_grand_shipping + v_shipping;
    v_total_points := v_total_points + v_order_points;
    v_total_redeemed := v_total_redeemed + v_order_redeem;
    v_orders := v_orders || jsonb_build_object(
      'id', v_order_id,
      'seller_id', v_group.seller_id,
      'subtotal', v_subtotal,
      'shipping', v_shipping,
      'points_redeemed', v_order_redeem,
      'total', v_order_total,
      'points', v_order_points
    );
  end loop;

  if v_payment = 'paymongo' and v_total_redeemed > 0 and v_grand_total < c_paymongo_minimum then
    raise exception 'Online payments must be at least PHP %. Use fewer points or choose another payment method.',
      c_paymongo_minimum using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'checkout_id', v_checkout,
    'fulfillment', v_fulfillment,
    'total', v_grand_total,
    'shipping', v_grand_shipping,
    'points_redeemed', v_total_redeemed,
    'points', v_total_points,
    'points_pending', true,
    'orders', v_orders
  );
end;
$$;

revoke all on function public.place_order(jsonb, text, text, text, text, text, text, text, text, text, integer) from public, anon;
grant execute on function public.place_order(jsonb, text, text, text, text, text, text, text, text, text, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Pickup wording in the order notifications
-- ----------------------------------------------------------------------------
create or replace function public.notify_order_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_label text;
  v_shop_name text;
  v_pickup boolean := new.fulfillment_method = 'pickup';
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  v_label := case new.status
    when 'confirmed'  then 'has been confirmed'
    when 'processing' then 'is being prepared'
    when 'shipped'    then case when v_pickup then 'is ready for pickup' else 'is on the way' end
    when 'delivered'  then case when v_pickup then 'was picked up' else 'was delivered' end
    when 'cancelled'  then 'was cancelled'
    else 'was updated'
  end;

  select s.business_name into v_shop_name from shop_sellers s where s.id = new.seller_id;

  perform public.push_notification(
    new.user_id,
    'customer',
    'order',
    'Your order ' || v_label,
    coalesce(nullif(btrim(v_shop_name), ''), 'The shop') ||
      case
        when new.status = 'shipped' and v_pickup then ' has your order ready. Tap Order Received after you pick it up.'
        when new.status = 'shipped' then ' has shipped your order. Tap Order Received once it arrives.'
        else ' updated your order.'
      end,
    '/shop/buyer?tab=orders&order=' || new.id::text
  );

  if new.status in ('delivered', 'cancelled') then
    perform public.push_notification(
      (select s.user_id from shop_sellers s where s.id = new.seller_id),
      'seller',
      'order',
      'An order was ' || new.status,
      coalesce(nullif(btrim(new.customer_name), ''), 'A customer') || '''s order is now ' || new.status || '.',
      '/shop/seller/dashboard?tab=orders&order=' || new.id::text
    );
  end if;

  return new;
end;
$$;

commit;
