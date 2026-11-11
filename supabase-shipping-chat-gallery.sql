-- ============================================================================
-- CONNECT-Daet - image galleries, shipping fees and customer/seller chat
-- ============================================================================
-- Run this ONCE in the Supabase SQL Editor, AFTER supabase-product-options.sql.
-- It is safe to re-run.
--
-- Deploy the website and this file together: place_order() gains two
-- parameters, so an older build of the site would not match it.
--
-- What it adds:
--   1. shop_products.images        - extra photos for the product gallery
--   2. shop_shipping_rates         - delivery fee per province/city
--   3. shipping_fee_for()          - the fee for one address and basket
--   4. shop_orders.shipping_fee    - what was actually charged
--   5. place_order()               - adds delivery to each shop's order
--   6. shop_conversations/messages - chat between a customer and a shop
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Product gallery
-- ----------------------------------------------------------------------------
-- ["https://.../1.jpg", "https://.../2.jpg"]. image_url stays the cover photo
-- so every existing screen keeps working.
alter table shop_products add column if not exists images jsonb not null default '[]'::jsonb;

-- ----------------------------------------------------------------------------
-- 2. Delivery fees
-- ----------------------------------------------------------------------------
-- A row with province = null is the fallback for anywhere not listed.
-- A row with a province and city = null covers that whole province.
create table if not exists shop_shipping_rates (
  id uuid primary key default gen_random_uuid(),
  province text,
  city text,
  fee numeric(10,2) not null default 0,
  free_threshold numeric(12,2),
  is_active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists idx_shipping_rates_area
  on shop_shipping_rates (coalesce(lower(province), ''), coalesce(lower(city), ''));

alter table shop_shipping_rates enable row level security;

drop policy if exists "shipping_rates_select_public" on shop_shipping_rates;
create policy "shipping_rates_select_public"
  on shop_shipping_rates for select
  to anon, authenticated
  using (true);

drop policy if exists "shipping_rates_write_admin" on shop_shipping_rates;
create policy "shipping_rates_write_admin"
  on shop_shipping_rates for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- A starting point: free inside Daet, a flat fee elsewhere. Edit these in
-- Admin -> Settings; they are only inserted when the table is empty.
insert into shop_shipping_rates (province, city, fee, free_threshold)
select * from (values
  (null::text, null::text, 150.00, null::numeric),
  ('Camarines Norte', null, 80.00, 2000.00),
  ('Camarines Norte', 'Daet', 0.00, null)
) as seed(province, city, fee, free_threshold)
where not exists (select 1 from shop_shipping_rates);

-- ----------------------------------------------------------------------------
-- 3. The fee for one address and one basket
-- ----------------------------------------------------------------------------
-- The most specific active rate wins: city, then province, then the fallback.
create or replace function public.shipping_fee_for(
  p_province text,
  p_city text,
  p_subtotal numeric default 0
)
returns numeric
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rate record;
begin
  select fee, free_threshold into v_rate
  from shop_shipping_rates
  where is_active
    and (
      province is null
      or (lower(province) = lower(coalesce(p_province, ''))
          and (city is null or lower(city) = lower(coalesce(p_city, ''))))
    )
  order by (province is not null) desc, (city is not null) desc
  limit 1;

  if not found then
    return 0;
  end if;

  if v_rate.free_threshold is not null and coalesce(p_subtotal, 0) >= v_rate.free_threshold then
    return 0;
  end if;

  return coalesce(v_rate.fee, 0);
end;
$$;

grant execute on function public.shipping_fee_for(text, text, numeric) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. What was charged, kept on the order
-- ----------------------------------------------------------------------------
alter table shop_orders add column if not exists shipping_fee numeric(10,2) not null default 0;

-- The field guard must pin it like the other money fields.
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

  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. place_order() with delivery
-- ----------------------------------------------------------------------------
-- The province and city come through separately so the fee can be worked out
-- here, on the server, instead of being trusted from the browser.
drop function if exists public.place_order(jsonb, text, text, text, text, text, text);

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

  if v_payment not in ('gcash', 'cod', 'bank') then
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

    -- Points are earned on the goods, not on the delivery fee.
    v_order_points := public._grant_order_points(
      v_user,
      (floor(v_subtotal / 100) * 10)::integer,
      v_order_id
    );

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
    'orders', v_orders
  );
end;
$$;

revoke all on function public.place_order(jsonb, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.place_order(jsonb, text, text, text, text, text, text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Chat between a customer and a shop
-- ----------------------------------------------------------------------------
create table if not exists shop_conversations (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references auth.users(id) on delete cascade,
  seller_id uuid not null references shop_sellers(id) on delete cascade,
  product_id uuid references shop_products(id) on delete set null,
  -- A shop cannot read customer profiles (RLS keeps them private), so the
  -- customer's display name and picture are copied onto the thread.
  buyer_name text,
  buyer_avatar_url text,
  created_at timestamptz default now(),
  last_message_at timestamptz default now(),
  unique (buyer_id, seller_id)
);

alter table shop_conversations add column if not exists buyer_name text;
alter table shop_conversations add column if not exists buyer_avatar_url text;

create table if not exists shop_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references shop_conversations(id) on delete cascade,
  sender_id uuid not null,
  sender_role text not null check (sender_role in ('buyer', 'seller')),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz default now(),
  read_at timestamptz
);

create index if not exists idx_conversations_buyer on shop_conversations(buyer_id);
create index if not exists idx_conversations_seller on shop_conversations(seller_id);
create index if not exists idx_messages_conversation on shop_messages(conversation_id, created_at);

-- True when the signed-in user is the buyer or the shop in this conversation.
create or replace function public.in_conversation(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from shop_conversations c
    where c.id = p_conversation_id
      and (c.buyer_id = auth.uid() or c.seller_id = public.current_seller_id())
  );
$$;

grant execute on function public.in_conversation(uuid) to authenticated;

alter table shop_conversations enable row level security;
alter table shop_messages enable row level security;

drop policy if exists "conversations_select_participants" on shop_conversations;
create policy "conversations_select_participants"
  on shop_conversations for select
  to authenticated
  using (buyer_id = auth.uid() or seller_id = public.current_seller_id() or public.is_admin());

drop policy if exists "conversations_insert_buyer" on shop_conversations;
create policy "conversations_insert_buyer"
  on shop_conversations for insert
  to authenticated
  with check (buyer_id = auth.uid());

drop policy if exists "conversations_update_participants" on shop_conversations;
create policy "conversations_update_participants"
  on shop_conversations for update
  to authenticated
  using (buyer_id = auth.uid() or seller_id = public.current_seller_id())
  with check (buyer_id = auth.uid() or seller_id = public.current_seller_id());

drop policy if exists "messages_select_participants" on shop_messages;
create policy "messages_select_participants"
  on shop_messages for select
  to authenticated
  using (public.in_conversation(conversation_id) or public.is_admin());

drop policy if exists "messages_insert_participants" on shop_messages;
create policy "messages_insert_participants"
  on shop_messages for insert
  to authenticated
  with check (sender_id = auth.uid() and public.in_conversation(conversation_id));

drop policy if exists "messages_update_participants" on shop_messages;
create policy "messages_update_participants"
  on shop_messages for update
  to authenticated
  using (public.in_conversation(conversation_id))
  with check (public.in_conversation(conversation_id));

-- Open the chat with a shop, reusing the existing thread when there is one.
create or replace function public.get_or_create_conversation(
  p_seller_id uuid,
  p_product_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_name text;
  v_avatar text;
begin
  if v_user is null then
    raise exception 'Please sign in to message a shop.' using errcode = '28000';
  end if;

  if not public.seller_is_public(p_seller_id) then
    raise exception 'This shop is not accepting messages right now.' using errcode = 'P0001';
  end if;

  -- This function runs as its owner, so it may read the buyer's own profile
  -- to copy the name the shop will see.
  select coalesce(nullif(trim(p.full_name), ''), split_part(coalesce(p.email, ''), '@', 1)),
         p.avatar_url
  into v_name, v_avatar
  from profiles p
  where p.id = v_user;

  select id into v_id
  from shop_conversations
  where buyer_id = v_user and seller_id = p_seller_id;

  if found then
    update shop_conversations
    set product_id = coalesce(p_product_id, product_id),
        buyer_name = coalesce(v_name, buyer_name),
        buyer_avatar_url = coalesce(v_avatar, buyer_avatar_url)
    where id = v_id;
    return v_id;
  end if;

  insert into shop_conversations (buyer_id, seller_id, product_id, buyer_name, buyer_avatar_url)
  values (v_user, p_seller_id, p_product_id, coalesce(v_name, 'Customer'), v_avatar)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.get_or_create_conversation(uuid, uuid) from public, anon;
grant execute on function public.get_or_create_conversation(uuid, uuid) to authenticated;

-- A shop opens a chat with one of its own customers. The shop must actually
-- have an order from that customer, so this cannot be used to message
-- strangers.
create or replace function public.message_customer(
  p_buyer_id uuid,
  p_product_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_seller uuid := public.current_seller_id();
  v_id uuid;
  v_name text;
  v_avatar text;
begin
  if v_seller is null then
    raise exception 'Only a shop can message a customer.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from shop_orders o
    where o.user_id = p_buyer_id
      and (o.seller_id = v_seller or public.seller_owns_order(o.id))
  ) then
    raise exception 'You can only message customers who have ordered from your shop.'
      using errcode = '42501';
  end if;

  select coalesce(nullif(trim(p.full_name), ''), split_part(coalesce(p.email, ''), '@', 1)),
         p.avatar_url
  into v_name, v_avatar
  from profiles p
  where p.id = p_buyer_id;

  select id into v_id
  from shop_conversations
  where buyer_id = p_buyer_id and seller_id = v_seller;

  if found then
    update shop_conversations
    set product_id = coalesce(p_product_id, product_id),
        buyer_name = coalesce(v_name, buyer_name),
        buyer_avatar_url = coalesce(v_avatar, buyer_avatar_url)
    where id = v_id;
    return v_id;
  end if;

  insert into shop_conversations (buyer_id, seller_id, product_id, buyer_name, buyer_avatar_url)
  values (p_buyer_id, v_seller, p_product_id, coalesce(v_name, 'Customer'), v_avatar)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.message_customer(uuid, uuid) from public, anon;
grant execute on function public.message_customer(uuid, uuid) to authenticated;

-- A shop may also start the thread, so the insert policy allows its own side.
drop policy if exists "conversations_insert_participant" on shop_conversations;
create policy "conversations_insert_participant"
  on shop_conversations for insert
  to authenticated
  with check (buyer_id = auth.uid() or seller_id = public.current_seller_id());

-- Keep the thread list ordered by the newest message.
create or replace function public.touch_conversation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update shop_conversations
  set last_message_at = now()
  where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists touch_conversation on shop_messages;
create trigger touch_conversation
  after insert on shop_messages
  for each row
  execute function public.touch_conversation();

commit;

-- ============================================================================
-- Checks after running (optional):
--   select province, city, fee, free_threshold from shop_shipping_rates;
--   select public.shipping_fee_for('Camarines Norte', 'Daet', 500);  -- 0
--   select public.shipping_fee_for('Albay', null, 500);              -- 150
-- ============================================================================
