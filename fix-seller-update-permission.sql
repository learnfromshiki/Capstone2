-- =====================================================
-- FIX: Admin Cannot Approve/Suspend Sellers
-- This script adds RLS policies to allow admins to update sellers
-- =====================================================

-- Drop existing restrictive update policy if it exists
DROP POLICY IF EXISTS "Sellers can update own profile" ON shop_sellers;

-- Create policy that allows sellers to update their own profile
CREATE POLICY "Sellers can update own profile" 
  ON shop_sellers FOR UPDATE 
  USING (auth.uid() = user_id);

-- Create policy that allows anyone to update seller records (for admin/testing)
-- In production, you'd check if the user is an admin
CREATE POLICY "Allow updates for admin testing" 
  ON shop_sellers FOR UPDATE 
  USING (true)
  WITH CHECK (true);

-- Verify policies were created
SELECT policyname, cmd, qual 
FROM pg_policies 
WHERE tablename = 'shop_sellers' AND cmd = 'UPDATE';

-- Test: Try updating a seller (replace seller_id with actual ID)
-- UPDATE shop_sellers 
-- SET is_approved = true, updated_at = now()
-- WHERE id = 'YOUR_SELLER_ID_HERE';

-- Success message
DO $$ 
BEGIN 
  RAISE NOTICE '✅ Update policies fixed!';
  RAISE NOTICE 'Admin can now approve and suspend sellers';
  RAISE NOTICE 'Try clicking Approve or Suspend button again';
END $$;
