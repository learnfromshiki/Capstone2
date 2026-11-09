-- ============================================================================
-- !! DO NOT RUN AGAINST THE LIVE DATABASE !!
-- The RLS policies in this file are open-access "for testing" policies: anyone
-- holding the public anon key can READ and WRITE profiles / orders / products.
-- supabase-security-hardening.sql now owns these permissions and drops every
-- one of them, so re-running this file silently re-opens those holes.
-- ============================================================================
-- =====================================================
-- CONNECT-Daet.ph - COMPLETE DATABASE SETUP
-- Run this file to set up all tables for the shop system
-- =====================================================

-- ==================== PART 1: BASE SHOP SYSTEM ====================

-- Products Table
CREATE TABLE IF NOT EXISTS shop_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  price DECIMAL(10,2) NOT NULL CHECK (price > 0),
  stock INTEGER DEFAULT 0 CHECK (stock >= 0),
  category TEXT CHECK (category IN ('handicrafts', 'food', 'souvenirs', 'weavings', 'art')),
  image_url TEXT,
  artisan_id UUID,
  artisan_name TEXT,
  seller_id UUID, -- Will be foreign key after sellers table created
  available BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Orders Table
CREATE TABLE IF NOT EXISTS shop_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  delivery_address TEXT NOT NULL,
  payment_method TEXT CHECK (payment_method IN ('gcash', 'cod', 'bank')),
  total_amount DECIMAL(10,2) NOT NULL CHECK (total_amount >= 0),
  status TEXT CHECK (status IN ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled')) DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Order Items Table
CREATE TABLE IF NOT EXISTS shop_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES shop_orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES shop_products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Reviews Table
CREATE TABLE IF NOT EXISTS shop_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES shop_products(id) ON DELETE CASCADE,
  user_id UUID,
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==================== PART 2: REWARDS SYSTEM ====================

-- Profiles Table (extends auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  points INTEGER DEFAULT 0 CHECK (points >= 0),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Reward History Table
CREATE TABLE IF NOT EXISTS reward_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  subsystem_source TEXT NOT NULL,
  points_earned INTEGER NOT NULL CHECK (points_earned > 0),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==================== PART 3: SELLER SYSTEM ====================

-- Sellers Table
CREATE TABLE IF NOT EXISTS shop_sellers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  business_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  contact_phone TEXT,
  address TEXT,
  description TEXT,
  logo_url TEXT,
  is_approved BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  commission_rate DECIMAL(5,2) DEFAULT 15.00,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add foreign key to shop_products now that shop_sellers exists
ALTER TABLE shop_products
ADD CONSTRAINT fk_products_seller
FOREIGN KEY (seller_id) REFERENCES shop_sellers(id) ON DELETE SET NULL;

-- Seller Earnings Table
CREATE TABLE IF NOT EXISTS shop_seller_earnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID REFERENCES shop_sellers(id) ON DELETE CASCADE,
  order_id UUID REFERENCES shop_orders(id) ON DELETE CASCADE,
  order_item_id UUID REFERENCES shop_order_items(id) ON DELETE CASCADE UNIQUE,
  product_sale_amount DECIMAL(10,2) NOT NULL,
  commission_amount DECIMAL(10,2) NOT NULL,
  seller_earning DECIMAL(10,2) NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  paid_at TIMESTAMP WITH TIME ZONE
);

-- ==================== PART 4: INDEXES ====================

-- Shop Products Indexes
CREATE INDEX IF NOT EXISTS idx_shop_products_category ON shop_products(category);
CREATE INDEX IF NOT EXISTS idx_shop_products_artisan ON shop_products(artisan_id);
CREATE INDEX IF NOT EXISTS idx_shop_products_available ON shop_products(available);
CREATE INDEX IF NOT EXISTS idx_shop_products_seller_id ON shop_products(seller_id);
CREATE INDEX IF NOT EXISTS idx_shop_products_seller_available ON shop_products(seller_id, available);

-- Shop Orders Indexes
CREATE INDEX IF NOT EXISTS idx_shop_orders_user ON shop_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_shop_orders_status ON shop_orders(status);
CREATE INDEX IF NOT EXISTS idx_shop_orders_user_status ON shop_orders(user_id, status);

-- Shop Order Items Indexes
CREATE INDEX IF NOT EXISTS idx_shop_order_items_order ON shop_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_shop_order_items_product ON shop_order_items(product_id);

-- Profiles Indexes
CREATE INDEX IF NOT EXISTS idx_profiles_points ON profiles(points);

-- Reward History Indexes
CREATE INDEX IF NOT EXISTS idx_reward_history_user_id ON reward_history(user_id);
CREATE INDEX IF NOT EXISTS idx_reward_history_source ON reward_history(subsystem_source);

-- Seller Earnings Indexes
CREATE INDEX IF NOT EXISTS idx_seller_earnings_seller_id ON shop_seller_earnings(seller_id);
CREATE INDEX IF NOT EXISTS idx_seller_earnings_status ON shop_seller_earnings(status);
CREATE INDEX IF NOT EXISTS idx_seller_earnings_seller_status ON shop_seller_earnings(seller_id, status);

-- ==================== PART 5: ROW LEVEL SECURITY ====================

-- Enable RLS on all tables
ALTER TABLE shop_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE reward_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_sellers ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_seller_earnings ENABLE ROW LEVEL SECURITY;

-- Shop Products RLS Policies
DROP POLICY IF EXISTS "Anyone can view available products" ON shop_products;
CREATE POLICY "Anyone can view available products" ON shop_products
  FOR SELECT USING (available = true);

DROP POLICY IF EXISTS "Anyone can create products (testing)" ON shop_products;
CREATE POLICY "Anyone can create products (testing)" ON shop_products
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can update products (testing)" ON shop_products;
CREATE POLICY "Anyone can update products (testing)" ON shop_products
  FOR UPDATE USING (true);

-- Shop Orders RLS Policies
DROP POLICY IF EXISTS "Anyone can view orders" ON shop_orders;
CREATE POLICY "Anyone can view orders" ON shop_orders
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Anyone can create orders" ON shop_orders;
CREATE POLICY "Anyone can create orders" ON shop_orders
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can update orders" ON shop_orders;
CREATE POLICY "Anyone can update orders" ON shop_orders
  FOR UPDATE USING (true);

-- Shop Order Items RLS Policies
DROP POLICY IF EXISTS "Anyone can view order items" ON shop_order_items;
CREATE POLICY "Anyone can view order items" ON shop_order_items
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Anyone can create order items" ON shop_order_items;
CREATE POLICY "Anyone can create order items" ON shop_order_items
  FOR INSERT WITH CHECK (true);

-- Shop Reviews RLS Policies
DROP POLICY IF EXISTS "Anyone can view reviews" ON shop_reviews;
CREATE POLICY "Anyone can view reviews" ON shop_reviews
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Anyone can create reviews" ON shop_reviews;
CREATE POLICY "Anyone can create reviews" ON shop_reviews
  FOR INSERT WITH CHECK (true);

-- Profiles RLS Policies
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
CREATE POLICY "Users can insert own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Reward History RLS Policies
DROP POLICY IF EXISTS "Users can view own reward history" ON reward_history;
CREATE POLICY "Users can view own reward history" ON reward_history
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "System can insert rewards" ON reward_history;
CREATE POLICY "System can insert rewards" ON reward_history
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Sellers RLS Policies
DROP POLICY IF EXISTS "Sellers can view own profile" ON shop_sellers;
CREATE POLICY "Sellers can view own profile" ON shop_sellers
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Sellers can update own profile" ON shop_sellers;
CREATE POLICY "Sellers can update own profile" ON shop_sellers
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Anyone can view approved sellers" ON shop_sellers;
CREATE POLICY "Anyone can view approved sellers" ON shop_sellers
  FOR SELECT USING (is_approved = true AND is_active = true);

DROP POLICY IF EXISTS "Authenticated users can create seller account" ON shop_sellers;
CREATE POLICY "Authenticated users can create seller account" ON shop_sellers
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Seller Earnings RLS Policies
DROP POLICY IF EXISTS "Sellers can view own earnings" ON shop_seller_earnings;
CREATE POLICY "Sellers can view own earnings" ON shop_seller_earnings
  FOR SELECT USING (
    seller_id IN (SELECT id FROM shop_sellers WHERE user_id = auth.uid())
  );

-- ==================== PART 6: FUNCTIONS & TRIGGERS ====================

-- Function to create profile on user signup
CREATE OR REPLACE FUNCTION create_profile_on_signup()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, full_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for profile creation
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION create_profile_on_signup();

-- Function to create seller earnings
CREATE OR REPLACE FUNCTION create_seller_earnings()
RETURNS TRIGGER AS $$
DECLARE
  v_seller_id UUID;
  v_commission_rate DECIMAL(5,2);
  v_sale_amount DECIMAL(10,2);
  v_commission DECIMAL(10,2);
  v_earning DECIMAL(10,2);
BEGIN
  SELECT p.seller_id, s.commission_rate INTO v_seller_id, v_commission_rate
  FROM shop_products p
  LEFT JOIN shop_sellers s ON p.seller_id = s.id
  WHERE p.id = NEW.product_id;

  IF v_seller_id IS NOT NULL THEN
    v_sale_amount := NEW.price * NEW.quantity;
    v_commission := v_sale_amount * (v_commission_rate / 100);
    v_earning := v_sale_amount - v_commission;

    INSERT INTO shop_seller_earnings (
      seller_id, order_id, order_item_id,
      product_sale_amount, commission_amount, seller_earning, status
    ) VALUES (
      v_seller_id, NEW.order_id, NEW.id,
      v_sale_amount, v_commission, v_earning, 'pending'
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for seller earnings
DROP TRIGGER IF EXISTS trigger_create_seller_earnings ON shop_order_items;
CREATE TRIGGER trigger_create_seller_earnings
  AFTER INSERT ON shop_order_items
  FOR EACH ROW
  EXECUTE FUNCTION create_seller_earnings();

-- Function to update seller earnings status
CREATE OR REPLACE FUNCTION update_seller_earnings_status()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'delivered' AND OLD.status != 'delivered' THEN
    UPDATE shop_seller_earnings
    SET status = 'paid', paid_at = NOW()
    WHERE order_id = NEW.id AND status = 'pending';
  END IF;

  IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' THEN
    UPDATE shop_seller_earnings
    SET status = 'cancelled'
    WHERE order_id = NEW.id AND status = 'pending';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for earnings status update
DROP TRIGGER IF EXISTS trigger_update_seller_earnings_status ON shop_orders;
CREATE TRIGGER trigger_update_seller_earnings_status
  AFTER UPDATE ON shop_orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION update_seller_earnings_status();

-- ==================== PART 7: VIEWS ====================

-- Seller Dashboard Stats View
CREATE OR REPLACE VIEW seller_dashboard_stats AS
SELECT 
  s.id as seller_id,
  s.user_id,
  s.business_name,
  COUNT(DISTINCT p.id) as total_products,
  COUNT(DISTINCT CASE WHEN p.available = true THEN p.id END) as active_products,
  COUNT(DISTINCT oi.order_id) as total_orders,
  COALESCE(SUM(se.product_sale_amount), 0) as total_sales,
  COALESCE(SUM(se.seller_earning), 0) as total_earnings,
  COALESCE(SUM(CASE WHEN se.status = 'pending' THEN se.seller_earning ELSE 0 END), 0) as pending_earnings,
  COALESCE(SUM(CASE WHEN se.status = 'paid' THEN se.seller_earning ELSE 0 END), 0) as paid_earnings
FROM shop_sellers s
LEFT JOIN shop_products p ON s.id = p.seller_id
LEFT JOIN shop_order_items oi ON p.id = oi.product_id
LEFT JOIN shop_seller_earnings se ON s.id = se.seller_id
GROUP BY s.id, s.user_id, s.business_name;

-- ==================== PART 8: SAMPLE DATA ====================

-- Insert sample products
INSERT INTO shop_products (name, description, price, stock, category, artisan_name, available) VALUES
  ('Handwoven Abaca Bag', 'Traditional handwoven bag made from local abaca fiber. Perfect for everyday use.', 450.00, 15, 'handicrafts', 'Maria Santos', true),
  ('Pili Nut Candy', 'Sweet and crunchy candy made from locally grown pili nuts. Pack of 10 pieces.', 120.00, 50, 'food', 'Daet Delicacies', true),
  ('Daet Keychain', 'Colorful wooden keychain featuring Daet landmarks. Great souvenir!', 80.00, 100, 'souvenirs', 'Local Crafts Co.', true),
  ('Traditional Banig Mat', 'Handwoven sleeping mat made from pandan leaves. Size: 4x6 feet.', 850.00, 8, 'weavings', 'Lola Remedios', true),
  ('Pineapple Fiber Shirt', 'Elegant barong-style shirt made from pineapple fiber (piña). Medium size.', 1200.00, 5, 'handicrafts', 'Juan dela Cruz', true),
  ('Bicol Express Paste', 'Authentic spicy Bicol Express cooking paste. 250g bottle.', 150.00, 30, 'food', 'Daet Delicacies', true),
  ('Miniature Paraw Boat', 'Handcrafted wooden model of traditional Filipino paraw sailboat.', 350.00, 12, 'souvenirs', 'Local Crafts Co.', true),
  ('Coconut Shell Bowl', 'Eco-friendly bowl carved from coconut shell. Perfect for serving snacks.', 180.00, 25, 'handicrafts', 'Green Crafts PH', true),
  ('Laing Mix', 'Ready-to-cook Laing (taro leaves in coconut milk) mix. 200g pack.', 95.00, 40, 'food', 'Daet Delicacies', true),
  ('Painted Capiz Wind Chime', 'Beautiful wind chime made from painted capiz shells.', 280.00, 18, 'art', 'Maria Santos', true)
ON CONFLICT DO NOTHING;

-- Success message
DO $$ 
BEGIN 
  RAISE NOTICE '✅ Database setup complete! All tables, indexes, RLS policies, and sample data created successfully.';
END $$;
