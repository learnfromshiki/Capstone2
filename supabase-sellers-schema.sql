-- Seller Account System Schema
-- This adds seller functionality to the e-commerce system

-- Create shop_sellers table
CREATE TABLE IF NOT EXISTS shop_sellers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  contact_phone TEXT,
  address TEXT,
  description TEXT,
  logo_url TEXT,
  is_approved BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  commission_rate DECIMAL(5,2) DEFAULT 15.00, -- Platform commission percentage
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Add seller_id to shop_products table
ALTER TABLE shop_products 
ADD COLUMN IF NOT EXISTS seller_id UUID REFERENCES shop_sellers(id) ON DELETE SET NULL;

-- Create index for faster seller product lookups
CREATE INDEX IF NOT EXISTS idx_products_seller_id ON shop_products(seller_id);

-- Create seller_earnings table to track sales and commissions
CREATE TABLE IF NOT EXISTS shop_seller_earnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID REFERENCES shop_sellers(id) ON DELETE CASCADE,
  order_id UUID REFERENCES shop_orders(id) ON DELETE CASCADE,
  order_item_id UUID REFERENCES shop_order_items(id) ON DELETE CASCADE,
  product_sale_amount DECIMAL(10,2) NOT NULL,
  commission_amount DECIMAL(10,2) NOT NULL,
  seller_earning DECIMAL(10,2) NOT NULL,
  status TEXT DEFAULT 'pending', -- pending, paid, cancelled
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  paid_at TIMESTAMP WITH TIME ZONE,
  UNIQUE(order_item_id)
);

-- Create index for seller earnings lookups
CREATE INDEX IF NOT EXISTS idx_seller_earnings_seller_id ON shop_seller_earnings(seller_id);
CREATE INDEX IF NOT EXISTS idx_seller_earnings_status ON shop_seller_earnings(status);

-- Enable Row Level Security (RLS)
ALTER TABLE shop_sellers ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_seller_earnings ENABLE ROW LEVEL SECURITY;

-- RLS Policies for shop_sellers
-- Allow sellers to read their own profile
CREATE POLICY "Sellers can view own profile" ON shop_sellers
  FOR SELECT
  USING (auth.uid() = user_id);

-- Allow sellers to update their own profile
CREATE POLICY "Sellers can update own profile" ON shop_sellers
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Allow anyone to view approved and active sellers
CREATE POLICY "Anyone can view approved sellers" ON shop_sellers
  FOR SELECT
  USING (is_approved = true AND is_active = true);

-- Allow authenticated users to create seller account
CREATE POLICY "Authenticated users can create seller account" ON shop_sellers
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies for shop_products (updated)
DROP POLICY IF EXISTS "Anyone can view available products" ON shop_products;
CREATE POLICY "Anyone can view available products" ON shop_products
  FOR SELECT
  USING (available = true);

-- Sellers can view their own products
CREATE POLICY "Sellers can view own products" ON shop_products
  FOR SELECT
  USING (
    seller_id IN (
      SELECT id FROM shop_sellers WHERE user_id = auth.uid()
    )
  );

-- Sellers can insert products
CREATE POLICY "Sellers can insert own products" ON shop_products
  FOR INSERT
  WITH CHECK (
    seller_id IN (
      SELECT id FROM shop_sellers WHERE user_id = auth.uid() AND is_approved = true AND is_active = true
    )
  );

-- Sellers can update their own products
CREATE POLICY "Sellers can update own products" ON shop_products
  FOR UPDATE
  USING (
    seller_id IN (
      SELECT id FROM shop_sellers WHERE user_id = auth.uid()
    )
  );

-- Sellers can delete their own products
CREATE POLICY "Sellers can delete own products" ON shop_products
  FOR DELETE
  USING (
    seller_id IN (
      SELECT id FROM shop_sellers WHERE user_id = auth.uid()
    )
  );

-- RLS Policies for shop_seller_earnings
-- Sellers can view their own earnings
CREATE POLICY "Sellers can view own earnings" ON shop_seller_earnings
  FOR SELECT
  USING (
    seller_id IN (
      SELECT id FROM shop_sellers WHERE user_id = auth.uid()
    )
  );

-- Function to automatically create seller earnings when order is placed
CREATE OR REPLACE FUNCTION create_seller_earnings()
RETURNS TRIGGER AS $$
DECLARE
  v_seller_id UUID;
  v_commission_rate DECIMAL(5,2);
  v_sale_amount DECIMAL(10,2);
  v_commission DECIMAL(10,2);
  v_earning DECIMAL(10,2);
BEGIN
  -- Get seller info from product
  SELECT p.seller_id, s.commission_rate INTO v_seller_id, v_commission_rate
  FROM shop_products p
  LEFT JOIN shop_sellers s ON p.seller_id = s.id
  WHERE p.id = NEW.product_id;

  -- Only create earnings if product has a seller
  IF v_seller_id IS NOT NULL THEN
    v_sale_amount := NEW.price * NEW.quantity;
    v_commission := v_sale_amount * (v_commission_rate / 100);
    v_earning := v_sale_amount - v_commission;

    INSERT INTO shop_seller_earnings (
      seller_id,
      order_id,
      order_item_id,
      product_sale_amount,
      commission_amount,
      seller_earning,
      status
    ) VALUES (
      v_seller_id,
      NEW.order_id,
      NEW.id,
      v_sale_amount,
      v_commission,
      v_earning,
      'pending'
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create earnings after order item is created
DROP TRIGGER IF EXISTS trigger_create_seller_earnings ON shop_order_items;
CREATE TRIGGER trigger_create_seller_earnings
  AFTER INSERT ON shop_order_items
  FOR EACH ROW
  EXECUTE FUNCTION create_seller_earnings();

-- Function to update seller earnings status when order status changes
CREATE OR REPLACE FUNCTION update_seller_earnings_status()
RETURNS TRIGGER AS $$
BEGIN
  -- Mark earnings as paid when order is completed
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    UPDATE shop_seller_earnings
    SET status = 'paid', paid_at = NOW()
    WHERE order_id = NEW.id AND status = 'pending';
  END IF;

  -- Mark earnings as cancelled when order is cancelled
  IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' THEN
    UPDATE shop_seller_earnings
    SET status = 'cancelled'
    WHERE order_id = NEW.id AND status = 'pending';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to update earnings status
DROP TRIGGER IF EXISTS trigger_update_seller_earnings_status ON shop_orders;
CREATE TRIGGER trigger_update_seller_earnings_status
  AFTER UPDATE ON shop_orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION update_seller_earnings_status();

-- Create view for seller dashboard stats
CREATE OR REPLACE VIEW seller_dashboard_stats AS
SELECT 
  s.id as seller_id,
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
GROUP BY s.id, s.business_name;

-- Grant access to view
GRANT SELECT ON seller_dashboard_stats TO authenticated;

-- Comments
COMMENT ON TABLE shop_sellers IS 'Stores seller account information';
COMMENT ON TABLE shop_seller_earnings IS 'Tracks earnings and commissions for each seller per order item';
COMMENT ON COLUMN shop_sellers.commission_rate IS 'Platform commission percentage (e.g., 15.00 for 15%)';
COMMENT ON COLUMN shop_sellers.is_approved IS 'Admin must approve sellers before they can sell';
COMMENT ON COLUMN shop_seller_earnings.status IS 'pending: awaiting order completion, paid: earnings released, cancelled: order cancelled';
