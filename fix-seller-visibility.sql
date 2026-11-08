-- =====================================================
-- FIX: Admin Cannot See Sellers in Dashboard
-- This script updates RLS policies to allow viewing all sellers
-- =====================================================

-- Drop the restrictive policy that only shows approved sellers
DROP POLICY IF EXISTS "Anyone can view approved sellers" ON shop_sellers;

-- Create a new policy that allows viewing ALL sellers (for testing/admin)
CREATE POLICY "Anyone can view all sellers" 
  ON shop_sellers FOR SELECT 
  USING (true);

-- Verify the policy was created
SELECT policyname, cmd, qual 
FROM pg_policies 
WHERE tablename = 'shop_sellers';

-- Check if there are any sellers in the database
SELECT 
  id,
  business_name,
  contact_email,
  is_approved,
  is_active,
  created_at
FROM shop_sellers
ORDER BY created_at DESC;

-- Success message
DO $$ 
BEGIN 
  RAISE NOTICE '✅ RLS Policy updated!';
  RAISE NOTICE 'Admin can now view ALL sellers (approved and unapproved)';
  RAISE NOTICE 'Refresh your admin page to see the sellers list';
END $$;
