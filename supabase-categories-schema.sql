-- =====================================================
-- Dynamic Categories Table
-- Allows creating custom product categories
-- =====================================================

-- Categories Table
CREATE TABLE IF NOT EXISTS shop_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  icon TEXT DEFAULT '📦',
  description TEXT,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE shop_categories ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Anyone can view active categories"
ON shop_categories FOR SELECT
USING (is_active = true);

CREATE POLICY "Authenticated users can view all categories"
ON shop_categories FOR SELECT
USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can create categories"
ON shop_categories FOR INSERT
WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update categories"
ON shop_categories FOR UPDATE
USING (auth.role() = 'authenticated');

-- Create index
CREATE INDEX IF NOT EXISTS idx_categories_active ON shop_categories(is_active);
CREATE INDEX IF NOT EXISTS idx_categories_slug ON shop_categories(slug);
CREATE INDEX IF NOT EXISTS idx_categories_order ON shop_categories(display_order);

-- Update shop_products to reference categories table
-- First, remove the old CHECK constraint
ALTER TABLE shop_products DROP CONSTRAINT IF EXISTS shop_products_category_check;

-- Add foreign key (optional - can keep as TEXT for flexibility)
-- ALTER TABLE shop_products ADD COLUMN category_id UUID REFERENCES shop_categories(id);

-- Insert default categories
INSERT INTO shop_categories (name, slug, icon, display_order) VALUES
  ('All Products', 'all', '🏪', 0),
  ('Handicrafts', 'handicrafts', '🧺', 1),
  ('Food', 'food', '🍽️', 2),
  ('Souvenirs', 'souvenirs', '🎁', 3),
  ('Weavings', 'weavings', '🧵', 4),
  ('Art', 'art', '🎨', 5)
ON CONFLICT (name) DO NOTHING;

-- Success message
DO $$ 
BEGIN 
  RAISE NOTICE '✅ Categories table created successfully! You can now create custom categories.';
END $$;
