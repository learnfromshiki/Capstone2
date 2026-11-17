-- ============================================================================
-- CONNECT-Daet.ph - reward points are earned when an order is received
--
-- Run in Supabase -> SQL Editor AFTER supabase-deep-scan-fixes.sql.
--
-- Before: place_order() gave points the moment an order was placed, so a
-- customer had points for goods they had not received (or might never pay for).
--
-- After:
--   1. place_order() no longer grants points. It still returns how many the
--      order WILL earn, so checkout can tell the customer.
--   2. A trigger grants the points when an order becomes 'delivered' - the
--      customer tapping "Order Received", or the shop/admin marking it
--      delivered. Cancelling still takes them back (_cancel_order_internal).
--   3. The customer can confirm receipt once the shop has accepted the order
--      (confirmed, processing or shipped), not only after "shipped".
--   4. add_reward_points() can no longer be called from the browser. It let
--      any signed-in user add up to 100,000 points to their own account.
--   5. Existing data is corrected: points on orders that are not delivered
--      yet are taken back, and delivered orders that never got points get them.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. place_order: report the points, do not grant them
-- ----------------------------------------------------------------------------
create or replace function public.place_order(
  p_items jsonb,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_delivery_address text,
  p_payment_method text,
  p_notes text default null,
  p_province text default null,
  p_city text default null
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
  v_subtotal numeric(12,2);
  v_shipping numeric(10,2);
  v_order_total numeric(12,2);
  v_order_points integer;
  v_orders jsonb := '[]'::jsonb;
  v_grand_total numeric(12,2) := 0;
  v_grand_shipping numeric(12,2) := 0;
  v_total_points integer := 0;
begin
  if v_user is null then
    raise exception 'Please sign in to place an order.' using errcode = '28000';
  end if;

  if not public.account_is_active() then
    raise exception 'This account has been suspended. Please contact CONNECT-Daet support.'
      using errcode = '42501';
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

  if length(v_address) < 5 or length(v_address) > 500 then
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

  -- One order per shop, each with its own delivery fee.
  for v_group in
    select p.seller_id,
           sum(p.price * n.quantity)::numeric(12,2) as subtotal
    from jsonb_to_recordset(v_lines) as n(product_id uuid, quantity integer, options jsonb)
    join shop_products p on p.id = n.product_id
    group by p.seller_id
    order by p.seller_id nulls last
  loop
    v_subtotal := v_group.subtotal;
    v_shipping := public.shipping_fee_for(p_province, p_city, v_subtotal);
    v_order_total := v_subtotal + v_shipping;

    insert into shop_orders (
      user_id, seller_id, checkout_id,
      customer_name, customer_email, customer_phone, delivery_address,
      payment_method, total_amount, shipping_fee, status, notes, created_at, updated_at
    ) values (
      v_user, v_group.seller_id, v_checkout,
      v_name, v_email, v_phone, v_address,
      v_payment, v_order_total, v_shipping, 'pending', v_notes, now(), now()
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

    -- Points are earned on the goods, not on the delivery fee, and only once
    -- the order is delivered (see grant_points_on_delivery below). This is
    -- what the order WILL earn, for the checkout screen.
    v_order_points := (floor(v_subtotal / 100) * 10)::integer;

    v_grand_total := v_grand_total + v_order_total;
    v_grand_shipping := v_grand_shipping + v_shipping;
    v_total_points := v_total_points + v_order_points;
    v_orders := v_orders || jsonb_build_object(
      'id', v_order_id,
      'seller_id', v_group.seller_id,
      'subtotal', v_subtotal,
      'shipping', v_shipping,
      'total', v_order_total,
      'points', v_order_points
    );
  end loop;

  return jsonb_build_object(
    'checkout_id', v_checkout,
    'total', v_grand_total,
    'shipping', v_grand_shipping,
    'points', v_total_points,
    'points_pending', true,
    'orders', v_orders
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Grant the points when the order is delivered
-- ----------------------------------------------------------------------------
create or replace function public.grant_points_on_delivery()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' then
    -- _grant_order_points() is idempotent per order, so a repeat is harmless.
    perform public._grant_order_points(
      new.user_id,
      (floor(greatest(coalesce(new.total_amount, 0) - coalesce(new.shipping_fee, 0), 0) / 100) * 10)::integer,
      new.id
    );
  end if;

  return new;
end;
$$;

drop trigger if exists grant_points_on_delivery on shop_orders;
create trigger grant_points_on_delivery
  after update of status on shop_orders
  for each row execute function public.grant_points_on_delivery();

-- ----------------------------------------------------------------------------
-- 3. The customer may confirm receipt once the shop has accepted the order
-- ----------------------------------------------------------------------------
create or replace function public.confirm_order_received(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_order record;
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

  if v_order.status = 'delivered' then
    return jsonb_build_object('status', 'delivered');
  end if;

  -- A pending order has not been accepted by the shop yet, and a cancelled
  -- one will never arrive.
  if v_order.status not in ('confirmed', 'processing', 'shipped') then
    raise exception 'The shop has not accepted this order yet, so it cannot be marked as received.'
      using errcode = 'P0001';
  end if;

  update shop_orders
  set status = 'delivered',
      updated_at = now()
  where id = p_order_id;

  return jsonb_build_object('status', 'delivered');
end;
$$;

revoke all on function public.confirm_order_received(uuid) from public, anon;
grant execute on function public.confirm_order_received(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Points are only ever granted by the database
-- ----------------------------------------------------------------------------
revoke all on function public.add_reward_points(integer, text, uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. Correct existing data
-- ----------------------------------------------------------------------------
-- Take back points on orders that have not been delivered.
select public._revoke_order_points(o.user_id, o.id)
from shop_orders o
where o.status <> 'delivered'
  and exists (select 1 from reward_history r where r.reference_id = o.id);

-- Give delivered orders the points they never received.
select public._grant_order_points(
  o.user_id,
  (floor(greatest(coalesce(o.total_amount, 0) - coalesce(o.shipping_fee, 0), 0) / 100) * 10)::integer,
  o.id
)
from shop_orders o
where o.status = 'delivered'
  and not exists (select 1 from reward_history r where r.reference_id = o.id);

commit;
