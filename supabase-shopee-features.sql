-- ============================================================================
-- Shopee-style features for CONNECT-Daet (2026-11-22)
--
--   * "X sold" counts          product_sold_counts()
--   * Sale price               shop_products.original_price (the "was" price)
--   * Cancel reason            shop_orders.cancel_reason, cancel_my_order(id, reason)
--   * Courier tracking         shop_orders.courier / tracking_number, set_order_tracking()
--   * Shop vouchers            shop_vouchers, applied by place_order(..., p_voucher_codes)
--   * Follow a shop            shop_follows, shop_follower_counts(), new-product alerts
--
-- Safe to run more than once.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- New columns
-- ---------------------------------------------------------------------------
alter table shop_products add column if not exists original_price numeric(12,2);
alter table shop_products drop constraint if exists shop_products_original_price_check;
alter table shop_products add constraint shop_products_original_price_check
  check (original_price is null or original_price > 0);

alter table shop_orders add column if not exists cancel_reason text;
alter table shop_orders add column if not exists courier text;
alter table shop_orders add column if not exists tracking_number text;
alter table shop_orders add column if not exists voucher_code text;
alter table shop_orders add column if not exists voucher_discount numeric(12,2) not null default 0;
alter table shop_orders drop constraint if exists shop_orders_voucher_discount_check;
alter table shop_orders add constraint shop_orders_voucher_discount_check check (voucher_discount >= 0);

-- Sellers may set the "was" price on their own products only.
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
    new.original_price := old.original_price;
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

-- What was charged (vouchers included) is fixed once the order exists.
create or replace function public.protect_order_customer_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- The database's own order functions (cancel with a reason, set tracking)
  -- say so for the length of their transaction.
  if auth.uid() is null or public.is_admin()
     or current_setting('app.trusted_order_update', true) = 'true' then
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
  new.xendit_session_id := old.xendit_session_id;
  new.paid_at := old.paid_at;
  new.fulfillment_method := old.fulfillment_method;
  new.points_redeemed := old.points_redeemed;
  new.points_discount := old.points_discount;
  new.voucher_code := old.voucher_code;
  new.voucher_discount := old.voucher_discount;
  new.cancel_reason := old.cancel_reason;
  new.courier := old.courier;
  new.tracking_number := old.tracking_number;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- "X sold": units in every order that was not cancelled. Only totals per
-- product leave the database, never who bought what.
-- ---------------------------------------------------------------------------
create or replace function public.product_sold_counts()
returns table (product_id uuid, sold bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select i.product_id, sum(i.quantity)::bigint
  from shop_order_items i
  join shop_orders o on o.id = i.order_id
  where i.product_id is not null
    and o.status <> 'cancelled'
  group by i.product_id;
$$;

revoke all on function public.product_sold_counts() from public;
grant execute on function public.product_sold_counts() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Cancel with a reason
-- ---------------------------------------------------------------------------
drop function if exists public.cancel_my_order(uuid);

create or replace function public.cancel_my_order(p_order_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_order record;
  v_restored integer;
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 300), '');
begin
  if v_user is null then
    raise exception 'Please sign in again.' using errcode = '28000';
  end if;

  select id, status, user_id, payment_status into v_order
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

  if v_order.payment_status = 'paid' then
    raise exception 'This order has already been paid online. Please contact the shop to cancel it and arrange a refund.'
      using errcode = 'P0001';
  end if;

  -- Written before the status change so the seller's notification can carry it.
  perform set_config('app.trusted_order_update', 'true', true);
  update shop_orders set cancel_reason = coalesce(v_reason, 'Cancelled by the customer')
  where id = p_order_id;
  perform set_config('app.trusted_order_update', 'false', true);

  v_restored := public._cancel_order_internal(p_order_id);

  return jsonb_build_object('status', 'cancelled', 'restored_items', v_restored);
end;
$$;

revoke all on function public.cancel_my_order(uuid, text) from public;
grant execute on function public.cancel_my_order(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Courier and tracking number, set by the shop (or the admin)
-- ---------------------------------------------------------------------------
create or replace function public.set_order_tracking(p_order_id uuid, p_courier text, p_tracking_number text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order record;
  v_courier text := nullif(left(btrim(coalesce(p_courier, '')), 60), '');
  v_number text := nullif(left(btrim(coalesce(p_tracking_number, '')), 80), '');
begin
  if auth.uid() is null then
    raise exception 'Please sign in again.' using errcode = '28000';
  end if;

  if not public.is_admin() and not public.seller_owns_order(p_order_id) then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;

  select id, user_id, status, fulfillment_method into v_order
  from shop_orders where id = p_order_id for update;

  if not found then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;

  if v_order.status = 'cancelled' then
    raise exception 'This order was cancelled.' using errcode = 'P0001';
  end if;

  perform set_config('app.trusted_order_update', 'true', true);
  update shop_orders
  set courier = v_courier, tracking_number = v_number, updated_at = now()
  where id = p_order_id;
  perform set_config('app.trusted_order_update', 'false', true);

  if v_number is not null then
    perform public.push_notification(
      v_order.user_id, 'customer', 'order',
      'Tracking number added',
      coalesce(v_courier || ' ', '') || 'tracking number ' || v_number,
      '/shop/buyer?tab=orders'
    );
  end if;
end;
$$;

revoke all on function public.set_order_tracking(uuid, text, text) from public;
grant execute on function public.set_order_tracking(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Shop vouchers
-- ---------------------------------------------------------------------------
create table if not exists shop_vouchers (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references shop_sellers(id) on delete cascade,
  code text not null,
  kind text not null check (kind in ('percent', 'fixed')),
  amount numeric(12,2) not null check (amount > 0),
  min_spend numeric(12,2) not null default 0 check (min_spend >= 0),
  max_discount numeric(12,2) check (max_discount is null or max_discount > 0),
  starts_at timestamptz,
  ends_at timestamptz,
  usage_limit integer check (usage_limit is null or usage_limit > 0),
  used_count integer not null default 0 check (used_count >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint shop_vouchers_code_format check (code ~ '^[A-Z0-9]{3,20}$'),
  constraint shop_vouchers_percent_range check (kind <> 'percent' or amount <= 90)
);

create unique index if not exists shop_vouchers_seller_code on shop_vouchers (seller_id, code);

alter table shop_vouchers enable row level security;

-- Codes are meant to be shared, so live ones are public (like a Shopee shop's
-- voucher strip). Shops manage their own; the admin manages all.
drop policy if exists "Live vouchers are public" on shop_vouchers;
create policy "Live vouchers are public" on shop_vouchers
  for select using (is_active and public.seller_is_public(seller_id));

drop policy if exists "Shops manage their vouchers" on shop_vouchers;
create policy "Shops manage their vouchers" on shop_vouchers
  for all to authenticated
  using (seller_id = public.current_seller_id() or public.is_admin())
  with check (seller_id = public.current_seller_id() or public.is_admin());

grant select on shop_vouchers to anon, authenticated;
grant insert, update, delete on shop_vouchers to authenticated;

-- Shops may not reset how often a code was used.
create or replace function public.protect_voucher_usage()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.code := upper(btrim(new.code));
  if current_setting('app.voucher_redemption', true) = 'true' or public.is_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.used_count := 0;
  else
    new.used_count := old.used_count;
    new.seller_id := old.seller_id;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_voucher_usage on shop_vouchers;
create trigger protect_voucher_usage
  before insert or update on shop_vouchers
  for each row execute function public.protect_voucher_usage();

-- ---------------------------------------------------------------------------
-- place_order with shop vouchers. Same as before, plus p_voucher_codes: each
-- shop's subtotal gets that shop's matching voucher, points can pay up to half
-- of what is left, and every code given must be usable or nothing is ordered.
-- ---------------------------------------------------------------------------
drop function if exists public.place_order(jsonb, text, text, text, text, text, text, text, text, text, integer);

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
  p_redeem_points integer default 0,
  p_voucher_codes jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  c_max_redeem_share constant numeric := 0.5;
  c_online_minimum constant numeric := 20;

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
  v_codes text[] := '{}';
  v_used_codes text[] := '{}';
  v_voucher record;
  v_discount numeric(12,2);
  v_voucher_code text;
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
  v_grand_discount numeric(12,2) := 0;
  v_total_points integer := 0;
  v_total_redeemed integer := 0;
  v_missing text;
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

  if v_payment not in ('gcash', 'cod', 'bank', 'xendit') then
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

  if p_voucher_codes is not null and jsonb_typeof(p_voucher_codes) <> 'null' then
    if jsonb_typeof(p_voucher_codes) <> 'array' or jsonb_array_length(p_voucher_codes) > 20 then
      raise exception 'The voucher codes are invalid.' using errcode = '22023';
    end if;
    select coalesce(array_agg(distinct upper(btrim(c))), '{}')
    into v_codes
    from jsonb_array_elements_text(p_voucher_codes) c
    where btrim(c) <> '';
  end if;

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

  for v_group in
    select p.seller_id,
           sum(p.price * n.quantity)::numeric(12,2) as subtotal
    from jsonb_to_recordset(v_lines) as n(product_id uuid, quantity integer, options jsonb)
    join shop_products p on p.id = n.product_id
    group by p.seller_id
    order by p.seller_id nulls last
  loop
    v_subtotal := v_group.subtotal;

    -- This shop's voucher, if one of the codes is theirs and still valid.
    v_discount := 0;
    v_voucher_code := null;
    if v_group.seller_id is not null and cardinality(v_codes) > 0 then
      select * into v_voucher
      from shop_vouchers vch
      where vch.seller_id = v_group.seller_id
        and vch.code = any (v_codes)
        and vch.is_active
        and (vch.starts_at is null or vch.starts_at <= now())
        and (vch.ends_at is null or vch.ends_at > now())
        and (vch.usage_limit is null or vch.used_count < vch.usage_limit)
      order by vch.created_at
      limit 1
      for update;

      if found then
        if v_subtotal < v_voucher.min_spend then
          select business_name into v_shop from shop_sellers where id = v_group.seller_id;
          raise exception 'Voucher % needs a minimum spend of PHP % at %.',
            v_voucher.code, v_voucher.min_spend, coalesce(v_shop.business_name, 'this shop')
            using errcode = 'P0001';
        end if;

        v_discount := case v_voucher.kind
          when 'percent' then round(v_subtotal * v_voucher.amount / 100, 2)
          else v_voucher.amount
        end;
        if v_voucher.max_discount is not null then
          v_discount := least(v_discount, v_voucher.max_discount);
        end if;
        -- Never more than the items; the delivery fee is still paid.
        v_discount := least(v_discount, v_subtotal);
        v_voucher_code := v_voucher.code;

        perform set_config('app.voucher_redemption', 'true', true);
        update shop_vouchers set used_count = used_count + 1 where id = v_voucher.id;
        perform set_config('app.voucher_redemption', 'false', true);

        v_used_codes := v_used_codes || v_voucher.code;
      end if;
    end if;

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

    v_order_redeem := least(v_redeem_left, floor((v_subtotal - v_discount) * c_max_redeem_share)::integer);
    v_redeem_left := v_redeem_left - v_order_redeem;

    v_order_total := v_subtotal - v_discount + v_shipping - v_order_redeem;

    insert into shop_orders (
      user_id, seller_id, checkout_id,
      customer_name, customer_email, customer_phone, delivery_address,
      payment_method, total_amount, shipping_fee, status, notes,
      fulfillment_method, points_redeemed, points_discount,
      voucher_code, voucher_discount,
      created_at, updated_at
    ) values (
      v_user, v_group.seller_id, v_checkout,
      v_name, v_email, v_phone, v_order_address,
      v_payment, v_order_total, v_shipping, 'pending', v_notes,
      v_fulfillment, v_order_redeem, v_order_redeem,
      v_voucher_code, v_discount,
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

    if v_order_redeem > 0 then
      perform set_config('app.allow_privileged_profile_update', 'true', true);

      update profiles
      set points = coalesce(points, 0) - v_order_redeem,
          updated_at = now()
      where id = v_user;

      insert into reward_history (user_id, subsystem_source, points_earned, reference_id)
      values (v_user, 'shop_redemption', -v_order_redeem, v_order_id);
    end if;

    v_order_points := (floor(greatest(v_order_total - v_shipping, 0) / 100) * 10)::integer;

    v_grand_total := v_grand_total + v_order_total;
    v_grand_shipping := v_grand_shipping + v_shipping;
    v_grand_discount := v_grand_discount + v_discount;
    v_total_points := v_total_points + v_order_points;
    v_total_redeemed := v_total_redeemed + v_order_redeem;
    v_orders := v_orders || jsonb_build_object(
      'id', v_order_id,
      'seller_id', v_group.seller_id,
      'subtotal', v_subtotal,
      'voucher_code', v_voucher_code,
      'voucher_discount', v_discount,
      'shipping', v_shipping,
      'points_redeemed', v_order_redeem,
      'total', v_order_total,
      'points', v_order_points
    );
  end loop;

  -- Every code given has to have been used, or the customer would think
  -- they got a discount they did not.
  select c into v_missing
  from unnest(v_codes) c
  where not (c = any (v_used_codes))
  limit 1;

  if v_missing is not null then
    raise exception 'Voucher % cannot be used on this order (unknown, expired, used up, or for another shop).', v_missing
      using errcode = 'P0001';
  end if;

  if v_payment = 'xendit' and (v_total_redeemed > 0 or v_grand_discount > 0) and v_grand_total < c_online_minimum then
    raise exception 'Online payments must be at least PHP %. Use fewer points or choose another payment method.',
      c_online_minimum using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'checkout_id', v_checkout,
    'fulfillment', v_fulfillment,
    'total', v_grand_total,
    'shipping', v_grand_shipping,
    'voucher_discount', v_grand_discount,
    'points_redeemed', v_total_redeemed,
    'points', v_total_points,
    'points_pending', true,
    'orders', v_orders
  );
end;
$function$;

revoke all on function public.place_order(jsonb, text, text, text, text, text, text, text, text, text, integer, jsonb) from public;
grant execute on function public.place_order(jsonb, text, text, text, text, text, text, text, text, text, integer, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Follow a shop
-- ---------------------------------------------------------------------------
create table if not exists shop_follows (
  user_id uuid not null references auth.users(id) on delete cascade,
  seller_id uuid not null references shop_sellers(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, seller_id)
);

create index if not exists shop_follows_seller on shop_follows (seller_id);

alter table shop_follows enable row level security;

drop policy if exists "People see whom they follow" on shop_follows;
create policy "People see whom they follow" on shop_follows
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "People follow shops" on shop_follows;
create policy "People follow shops" on shop_follows
  for insert to authenticated
  with check (user_id = auth.uid() and public.seller_is_public(seller_id));

drop policy if exists "People unfollow shops" on shop_follows;
create policy "People unfollow shops" on shop_follows
  for delete to authenticated using (user_id = auth.uid());

grant select, insert, delete on shop_follows to authenticated;

-- Follower totals are public; who follows whom is not.
create or replace function public.shop_follower_counts()
returns table (seller_id uuid, followers bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select f.seller_id, count(*)::bigint from shop_follows f group by f.seller_id;
$$;

revoke all on function public.shop_follower_counts() from public;
grant execute on function public.shop_follower_counts() to anon, authenticated;

-- Tell a shop's followers when it lists something new.
create or replace function public.notify_followers_new_product()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_shop text;
  v_follower record;
begin
  if new.seller_id is null or new.available is distinct from true then
    return new;
  end if;

  select business_name into v_shop from shop_sellers where id = new.seller_id;

  for v_follower in
    select f.user_id from shop_follows f where f.seller_id = new.seller_id limit 1000
  loop
    perform public.push_notification(
      v_follower.user_id, 'customer', 'shop',
      'New from ' || coalesce(v_shop, 'a shop you follow'),
      new.name || ' is now available.',
      '/shop?product=' || new.id
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists notify_followers_new_product on shop_products;
create trigger notify_followers_new_product
  after insert on shop_products
  for each row execute function public.notify_followers_new_product();

commit;
