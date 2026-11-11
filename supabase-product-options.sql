-- ============================================================================
-- CONNECT-Daet - product options, order variants, review authors, avatars
-- ============================================================================
-- Run this ONCE in the Supabase SQL Editor, AFTER supabase-checkout-security.sql
-- and supabase-auth-roles-fix.sql. It is safe to re-run.
--
-- What it adds:
--   1. shop_products.options      - the choices a seller offers (Colour, Size...)
--   2. shop_order_items.options   - what the buyer actually picked
--   3. shop_reviews author fields - so a review can show who wrote it
--   4. profile-images bucket      - profile pictures for customers/sellers/admins
--   5. place_order() updated      - carries the chosen options onto the order
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. What the seller offers
-- ----------------------------------------------------------------------------
-- [{"name": "Colour", "values": ["Red", "Blue"]}, {"name": "Size", "values": ["S","M"]}]
alter table shop_products add column if not exists options jsonb not null default '[]'::jsonb;

-- ----------------------------------------------------------------------------
-- 2. What the buyer picked, stored on the order line
-- ----------------------------------------------------------------------------
-- {"Colour": "Red", "Size": "M"}
alter table shop_order_items add column if not exists options jsonb;

-- ----------------------------------------------------------------------------
-- 3. Who wrote a review
-- ----------------------------------------------------------------------------
-- profiles is readable only by its owner and admins, by design, so a shopper
-- cannot look up the name behind someone else's review. The display name and
-- picture are therefore copied onto the review when it is written.
alter table shop_reviews add column if not exists reviewer_name text;
alter table shop_reviews add column if not exists reviewer_avatar_url text;

-- Fill in the ones written before this change (runs as the SQL editor, which
-- can read every profile).
update shop_reviews r
set reviewer_name = coalesce(nullif(trim(p.full_name), ''), split_part(coalesce(p.email, ''), '@', 1)),
    reviewer_avatar_url = p.avatar_url
from profiles p
where p.id = r.user_id
  and r.reviewer_name is null;

-- ----------------------------------------------------------------------------
-- 4. Profile pictures
-- ----------------------------------------------------------------------------
alter table profiles add column if not exists avatar_url text;

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'profile-images',
      'profile-images',
      true,
      2097152, -- 2 MB
      array['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    )
    on conflict (id) do update
      set public = true,
          file_size_limit = 2097152,
          allowed_mime_types = array['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

    execute 'drop policy if exists "profile_images_read_public" on storage.objects';
    execute $policy$
      create policy "profile_images_read_public"
      on storage.objects for select
      to anon, authenticated
      using (bucket_id = 'profile-images')
    $policy$;

    -- Everyone may write only inside a folder named after their own user id.
    execute 'drop policy if exists "profile_images_insert_own_folder" on storage.objects';
    execute $policy$
      create policy "profile_images_insert_own_folder"
      on storage.objects for insert
      to authenticated
      with check (
        bucket_id = 'profile-images'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
    $policy$;

    execute 'drop policy if exists "profile_images_update_own_folder" on storage.objects';
    execute $policy$
      create policy "profile_images_update_own_folder"
      on storage.objects for update
      to authenticated
      using (
        bucket_id = 'profile-images'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
    $policy$;

    execute 'drop policy if exists "profile_images_delete_own_folder" on storage.objects';
    execute $policy$
      create policy "profile_images_delete_own_folder"
      on storage.objects for delete
      to authenticated
      using (
        bucket_id = 'profile-images'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
    $policy$;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. place_order() carries the chosen options
-- ----------------------------------------------------------------------------
-- Same function as supabase-checkout-security.sql, with one addition: each cart
-- line may carry an "options" object, which is validated against what the
-- seller actually offers and copied onto the order line.
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
       or (e ? 'options' and jsonb_typeof(e->'options') not in ('object', 'null'))
  ) then
    raise exception 'One of the items in your cart is invalid. Please remove it and try again.'
      using errcode = '22023';
  end if;

  -- Merge duplicate lines for the same product AND the same chosen options, so
  -- a red and a blue one stay separate lines.
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

  -- Lock every product (in a fixed order to avoid deadlocks) and validate it.
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

    -- Every choice the seller asks for must be made, and must be one of the
    -- values they listed. This stops a made-up variant reaching the order.
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

  -- One order per shop ----------------------------------------------------------
  for v_group in
    select p.seller_id,
           sum(p.price * n.quantity)::numeric(12,2) as total
    from jsonb_to_recordset(v_lines) as n(product_id uuid, quantity integer, options jsonb)
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

commit;

-- ============================================================================
-- Checks after running (optional):
--   select id, name, options from shop_products limit 5;
--   select id, bucket_id from storage.buckets where id = 'profile-images';
-- ============================================================================
