-- =====================================================
-- CONNECT-Daet.ph - Shop System Database Schema (STANDALONE)
-- Local Artisan and Product E-commerce Platform
-- This version works WITHOUT the profiles table
-- =====================================================

-- Products Table
create table shop_products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price decimal(10,2) not null,
  stock integer default 0,
  category text check (category in ('handicrafts', 'food', 'souvenirs', 'weavings', 'art')),
  image_url text,
  artisan_id uuid,  -- No foreign key constraint
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

-- Enable Row Level Security
alter table shop_products enable row level security;
alter table shop_orders enable row level security;
alter table shop_order_items enable row level security;
alter table shop_reviews enable row level security;

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

-- RLS Policies for Reviews (Allow ALL for testing)
create policy "Anyone can view reviews" 
  on shop_reviews for select 
  using (true);

create policy "Anyone can create reviews" 
  on shop_reviews for insert 
  with check (true);

-- Create indexes for better performance
create index idx_shop_products_category on shop_products(category);
create index idx_shop_products_artisan on shop_products(artisan_id);
create index idx_shop_products_available on shop_products(available);
create index idx_shop_orders_user on shop_orders(user_id);
create index idx_shop_orders_status on shop_orders(status);
create index idx_shop_order_items_order on shop_order_items(order_id);
create index idx_shop_order_items_product on shop_order_items(product_id);

-- Insert sample products
insert into shop_products (name, description, price, stock, category, artisan_name, available) values
  ('Handwoven Abaca Bag', 'Traditional handwoven bag made from local abaca fiber. Perfect for everyday use.', 450.00, 15, 'handicrafts', 'Maria Santos', true),
  ('Pili Nut Candy', 'Sweet and crunchy candy made from locally grown pili nuts. Pack of 10 pieces.', 120.00, 50, 'food', 'Daet Delicacies', true),
  ('Daet Keychain', 'Colorful wooden keychain featuring Daet landmarks. Great souvenir!', 80.00, 100, 'souvenirs', 'Local Crafts Co.', true),
  ('Traditional Banig Mat', 'Handwoven sleeping mat made from pandan leaves. Size: 4x6 feet.', 850.00, 8, 'weavings', 'Lola Remedios', true),
  ('Pineapple Fiber Shirt', 'Elegant barong-style shirt made from pineapple fiber (piña). Medium size.', 1200.00, 5, 'handicrafts', 'Juan dela Cruz', true),
  ('Bicol Express Paste', 'Authentic spicy Bicol Express cooking paste. 250g bottle.', 150.00, 30, 'food', 'Daet Delicacies', true),
  ('Miniature Paraw Boat', 'Handcrafted wooden model of traditional Filipino paraw sailboat.', 350.00, 12, 'souvenirs', 'Local Crafts Co.', true),
  ('Coconut Shell Bowl', 'Eco-friendly bowl carved from coconut shell. Perfect for serving snacks.', 180.00, 25, 'handicrafts', 'Green Crafts PH', true),
  ('Laing Mix', 'Ready-to-cook Laing (taro leaves in coconut milk) mix. 200g pack.', 95.00, 40, 'food', 'Daet Delicacies', true),
  ('Painted Capiz Wind Chime', 'Beautiful wind chime made from painted capiz shells.', 280.00, 18, 'art', 'Maria Santos', true);

-- Success message
DO $$ 
BEGIN 
  RAISE NOTICE 'Shop tables created successfully! 10 sample products added.';
END $$;
