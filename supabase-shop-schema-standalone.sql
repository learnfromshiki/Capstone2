-- =====================================================
-- CONNECT-Daet.ph - Shop System Database Schema (STANDALONE)
-- Local Artisan and Product E-commerce Platform
-- This version works WITHOUT the profiles table
-- =====================================================

-- Sellers Table
create table shop_sellers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique not null,  -- Links to Supabase Auth user
  business_name text not null,
  contact_email text not null,
  contact_phone text,
  address text,
  description text,
  is_approved boolean default false,  -- Requires admin approval
  is_active boolean default true,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Products Table
create table shop_products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price decimal(10,2) not null,
  stock integer default 0,
  category text,  -- Now uses dynamic categories from shop_categories
  image_url text,
  seller_id uuid references shop_sellers(id) on delete cascade,
  artisan_name text,
  available boolean default true,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Orders Table
create table shop_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,  -- No foreign key constraint
  customer_name text not null,
  customer_email text not null,
  customer_phone text not null,
  delivery_address text not null,
  payment_method text check (payment_method in ('gcash', 'cod', 'bank')),
  total_amount decimal(10,2) not null,
  status text check (status in ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled')) default 'pending',
  notes text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Order Items Table
create table shop_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references shop_orders(id) on delete cascade,
  product_id uuid references shop_products(id),
  product_name text not null,
  quantity integer not null,
  price decimal(10,2) not null,
  created_at timestamp with time zone default now()
);

-- Artisan Reviews Table (Optional - for future feature)
create table shop_reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references shop_products(id) on delete cascade,
  user_id uuid,  -- No foreign key constraint
  rating integer check (rating >= 1 and rating <= 5),
  comment text,
  created_at timestamp with time zone default now()
);

-- Categories Table (Dynamic category management)
create table shop_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  icon text,
  description text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Insert default categories
insert into shop_categories (name, slug, icon, description) values
  ('All', 'all', '🛍️', 'All products'),
  ('Handicrafts', 'handicrafts', '🎨', 'Handmade crafts and artworks'),
  ('Food Products', 'food', '🍽️', 'Local food and delicacies'),
  ('Souvenirs', 'souvenirs', '🎁', 'Memorable souvenirs'),
  ('Weavings', 'weavings', '🧵', 'Traditional woven products'),
  ('Art', 'art', '🎨', 'Artistic creations');

-- Enable Row Level Security
alter table shop_sellers enable row level security;
alter table shop_products enable row level security;
alter table shop_orders enable row level security;
alter table shop_order_items enable row level security;
alter table shop_reviews enable row level security;
alter table shop_categories enable row level security;

-- RLS Policies for Sellers
create policy "Anyone can view approved sellers" 
  on shop_sellers for select 
  using (is_approved = true);

create policy "Anyone can create seller account" 
  on shop_sellers for insert 
  with check (true);

create policy "Sellers can update own profile" 
  on shop_sellers for update 
  using (auth.uid() = user_id);

-- RLS Policies for Products (Allow ALL for testing)
create policy "Anyone can view products" 
  on shop_products for select 
  using (true);

create policy "Anyone can create products (for testing)" 
  on shop_products for insert 
  with check (true);

create policy "Anyone can update products (for testing)" 
  on shop_products for update 
  using (true);

-- RLS Policies for Orders (Allow ALL for testing)
create policy "Anyone can view orders" 
  on shop_orders for select 
  using (true);

create policy "Anyone can create orders" 
  on shop_orders for insert 
  with check (true);

create policy "Anyone can update orders" 
  on shop_orders for update 
  using (true);

-- RLS Policies for Order Items (Allow ALL for testing)
create policy "Anyone can view order items" 
  on shop_order_items for select 
  using (true);

create policy "Anyone can create order items" 
  on shop_order_items for insert 
  with check (true);

-- RLS Policies for Categories
create policy "Anyone can view categories" 
  on shop_categories for select 
  using (true);

create policy "Anyone can manage categories (for testing)" 
  on shop_categories for all 
  using (true);

-- RLS Policies for Reviews
create policy "Anyone can view reviews" 
  on shop_reviews for select 
  using (true);

create policy "Anyone can create reviews" 
  on shop_reviews for insert 
  with check (true);

-- Create indexes for better performance
create index idx_shop_sellers_user on shop_sellers(user_id);
create index idx_shop_sellers_approved on shop_sellers(is_approved);
create index idx_shop_products_seller on shop_products(seller_id);
create index idx_shop_products_category on shop_products(category);
create index idx_shop_products_available on shop_products(available);
create index idx_shop_orders_user on shop_orders(user_id);
create index idx_shop_orders_status on shop_orders(status);
create index idx_shop_order_items_order on shop_order_items(order_id);
create index idx_shop_order_items_product on shop_order_items(product_id);

-- Success message
DO $$ 
BEGIN 
  RAISE NOTICE 'Shop database schema created successfully!';
  RAISE NOTICE 'Tables: shop_sellers, shop_products, shop_orders, shop_order_items, shop_categories, shop_reviews';
  RAISE NOTICE 'Default categories have been added.';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '1. Create storage bucket "product-images" with public access';
  RAISE NOTICE '2. Test seller registration at /shop';
  RAISE NOTICE '3. Admin can approve sellers at /shop/admin';
END $$;
