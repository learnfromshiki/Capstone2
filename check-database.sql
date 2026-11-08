-- =====================================================
-- DATABASE DIAGNOSTIC SCRIPT
-- Run this to check what's in your database
-- =====================================================

-- 1. Check if shop_sellers table exists
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_name = 'shop_sellers'
) AS shop_sellers_exists;

-- 2. Count total sellers
SELECT COUNT(*) AS total_sellers FROM shop_sellers;

-- 3. Show all sellers with details
SELECT 
  id,
  user_id,
  business_name,
  contact_email,
  contact_phone,
  is_approved,
  is_active,
  created_at
FROM shop_sellers
ORDER BY created_at DESC;

-- 4. Check RLS policies on shop_sellers
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  cmd,
  qual
FROM pg_policies 
WHERE tablename = 'shop_sellers';

-- 5. Check if RLS is enabled
SELECT 
  tablename,
  rowsecurity
FROM pg_tables
WHERE tablename = 'shop_sellers';

-- 6. Try to insert a test seller (will fail if user_id already exists)
-- Uncomment the lines below to test insert
/*
INSERT INTO shop_sellers (
  user_id,
  business_name,
  contact_email,
  is_approved,
  is_active
) VALUES (
  gen_random_uuid(),
  'Test Shop',
  'testshop@example.com',
  false,
  true
);
*/

-- Success message
DO $$ 
DECLARE
  seller_count INTEGER;
BEGIN 
  SELECT COUNT(*) INTO seller_count FROM shop_sellers;
  
  RAISE NOTICE '===========================================';
  RAISE NOTICE 'DATABASE DIAGNOSTIC RESULTS';
  RAISE NOTICE '===========================================';
  RAISE NOTICE 'Total sellers in database: %', seller_count;
  
  IF seller_count = 0 THEN
    RAISE NOTICE '⚠️  WARNING: No sellers found!';
    RAISE NOTICE '   The seller registration might have failed.';
    RAISE NOTICE '   Check the registration error logs.';
  ELSE
    RAISE NOTICE '✅ Sellers exist in database!';
    RAISE NOTICE '   If admin cannot see them, it''s an RLS policy issue.';
    RAISE NOTICE '   Run fix-seller-visibility.sql to fix.';
  END IF;
  
  RAISE NOTICE '===========================================';
END $$;
