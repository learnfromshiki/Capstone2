-- =====================================================
-- SAFE UPDATE SCRIPT - Only adds missing tables/columns
-- Run this if shop_sellers already exists
-- =====================================================

-- Check and add missing columns to shop_sellers if needed
DO $$ 
BEGIN
  -- Add description column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'shop_sellers' AND column_name = 'description'
  ) THEN
    ALTER TABLE shop_sellers ADD COLUMN description text;
  END IF;

  -- Add is_active column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'shop_sellers' AND column_name = 'is_active'
  ) THEN
    ALTER TABLE shop_sellers ADD COLUMN is_active boolean default true;
  END IF;
END $$;

-- Create shop_categories table if it doesn't exist
create table if not exists shop_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  icon text,
  description text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Insert default categories (skip if already exist)
insert into shop_categories (name, slug, icon, description) values
  ('All', 'all', '🛍️', 'All products'),
  ('Handicrafts', 'handicrafts', '🎨', 'Handmade crafts and artworks'),
  ('Food Products', 'food', '🍽️', 'Local food and delicacies'),
  ('Souvenirs', 'souvenirs', '🎁', 'Memorable souvenirs'),
  ('Weavings', 'weavings', '🧵', 'Traditional woven products'),
  ('Art', 'art', '🎨', 'Artistic creations')
on conflict (slug) do nothing;

-- Enable RLS on shop_sellers if not already enabled
alter table shop_sellers enable row level security;
alter table shop_categories enable row level security;

-- Drop existing policies if they exist (to avoid conflicts)
drop policy if exists "Anyone can view approved sellers" on shop_sellers;
drop policy if exists "Anyone can create seller account" on shop_sellers;
drop policy if exists "Sellers can update own profile" on shop_sellers;
drop policy if exists "Anyone can view categories" on shop_categories;
drop policy if exists "Anyone can manage categories (for testing)" on shop_categories;

-- Recreate policies
create policy "Anyone can view approved sellers" 
  on shop_sellers for select 
  using (is_approved = true);

create policy "Anyone can create seller account" 
  on shop_sellers for insert 
  with check (true);

create policy "Sellers can update own profile" 
  on shop_sellers for update 
  using (auth.uid() = user_id);

create policy "Anyone can view categories" 
  on shop_categories for select 
  using (true);

create policy "Anyone can manage categories (for testing)" 
  on shop_categories for all 
  using (true);

-- Create indexes if they don't exist
create index if not exists idx_shop_sellers_user on shop_sellers(user_id);
create index if not exists idx_shop_sellers_approved on shop_sellers(is_approved);

-- Success message
DO $$ 
BEGIN 
  RAISE NOTICE '✅ Database updated successfully!';
  RAISE NOTICE 'Tables verified: shop_sellers, shop_categories';
  RAISE NOTICE 'RLS policies updated';
  RAISE NOTICE 'You can now test seller registration!';
END $$;
