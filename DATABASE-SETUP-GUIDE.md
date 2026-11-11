# Database Setup Guide - Fix for Seller Registration Error

## ❌ Error: "Account created but seller profile failed"

This error occurs because the `shop_sellers` table doesn't exist in your Supabase database yet.

---

## ✅ Solution: Run the Updated SQL Schema

### Step 1: Access Supabase SQL Editor

1. Go to https://supabase.com
2. Open your project
3. Click on **SQL Editor** in the left sidebar

### Step 2: Run the Complete Schema

Copy and paste the **ENTIRE contents** of `supabase-shop-schema-standalone.sql` into the SQL Editor and click **Run**.

This will create:
- ✅ `shop_sellers` table (for seller accounts)
- ✅ `shop_products` table (for products)
- ✅ `shop_orders` table (for orders)
- ✅ `shop_order_items` table (for order details)
- ✅ `shop_categories` table (for dynamic categories)
- ✅ `shop_reviews` table (for product reviews)
- ✅ All RLS (Row Level Security) policies

### Step 3: Verify Tables Created

After running the SQL, check that all tables exist:

1. Click **Table Editor** in left sidebar
2. You should see these tables:
   - shop_sellers
   - shop_products
   - shop_orders
   - shop_order_items
   - shop_categories
   - shop_reviews

### Step 4: Setup Storage Bucket

1. Click **Storage** in left sidebar
2. Click **New bucket**
3. Name: `product-images`
4. Set to **Public bucket** (toggle ON)
5. Click **Create bucket**

6. Click on the `product-images` bucket
7. Go to **Policies** tab
8. Add these policies:

**Policy 1: Allow Public Read**
```sql
CREATE POLICY "Public Read Access"
ON storage.objects FOR SELECT
USING (bucket_id = 'product-images');
```

**Policy 2: Allow Authenticated Upload**
```sql
CREATE POLICY "Authenticated Upload"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'product-images' AND auth.role() = 'authenticated');
```

**Policy 3: Allow Authenticated Delete**
```sql
CREATE POLICY "Authenticated Delete"
ON storage.objects FOR DELETE
USING (bucket_id = 'product-images' AND auth.role() = 'authenticated');
```

Or run the `supabase-storage-setup.sql` file in SQL Editor.

---

## 🧪 Test the Fix

### Test Seller Registration

1. Clear browser cache/cookies (to remove any stale auth)
2. Go to http://localhost:3000/shop
3. Click "Sign In"
4. Select **Seller** card
5. Fill in registration:
   - Full Name: Test Seller
   - Email: testseller@example.com
   - Shop Name: My Test Shop
   - Password: test1234
6. Click "Sign Up"

**Expected Result**: ✅ "Seller account created! Awaiting admin approval."

### Verify in Database

1. Go to Supabase **Table Editor**
2. Open `shop_sellers` table
3. You should see your new seller record with:
   - `business_name`: My Test Shop
   - `contact_email`: testseller@example.com
   - `is_approved`: false (awaiting approval)
   - `is_active`: true

### Approve the Seller

1. Login as Admin: http://localhost:3000/shop/admin
   - Email: shiki@gmail.com
   - Password: (private: see ADMIN-CREDENTIALS.md)
2. Go to **Sellers** tab
3. Find "My Test Shop"
4. Click **Approve**

**Expected Result**: ✅ Seller status changes to "Approved"

### Test Seller Login

1. Go to http://localhost:3000/shop/seller/dashboard
2. Login with seller credentials
3. You should see the seller dashboard

---

## 🔍 Troubleshooting

### Error: "relation 'shop_sellers' does not exist"
**Solution**: Run the SQL schema file again. The table wasn't created.

### Error: "insert or update on table 'shop_products' violates foreign key constraint"
**Solution**: The `shop_sellers` table must exist before adding products with `seller_id`.

### Error: "new row violates row-level security policy for table 'shop_sellers'"
**Solution**: RLS policies might be too restrictive. Check the policies in Supabase:
```sql
-- Allow anyone to create seller account
create policy "Anyone can create seller account" 
  on shop_sellers for insert 
  with check (true);
```

### Error: "bucket 'product-images' does not exist"
**Solution**: Create the storage bucket as described in Step 4 above.

### Registration works but can't see seller in admin
**Solution**: Check RLS policy for viewing sellers:
```sql
-- Update policy to allow admins to view all sellers
drop policy if exists "Anyone can view approved sellers" on shop_sellers;

create policy "Anyone can view sellers for testing" 
  on shop_sellers for select 
  using (true);
```

---

## 📋 Database Schema Overview

### shop_sellers Table
```sql
- id: uuid (primary key)
- user_id: uuid (links to Supabase Auth)
- business_name: text (shop name)
- contact_email: text
- contact_phone: text (optional)
- address: text (optional)
- description: text (optional)
- is_approved: boolean (default: false)
- is_active: boolean (default: true)
- created_at: timestamp
- updated_at: timestamp
```

### shop_products Table
```sql
- id: uuid (primary key)
- name: text
- description: text
- price: decimal(10,2)
- stock: integer
- category: text
- image_url: text
- seller_id: uuid (foreign key to shop_sellers)
- artisan_name: text
- available: boolean
- created_at: timestamp
- updated_at: timestamp
```

### shop_categories Table
```sql
- id: uuid (primary key)
- name: text (unique)
- slug: text (unique)
- icon: text (emoji)
- description: text
- created_at: timestamp
- updated_at: timestamp
```

---

## ✅ Verification Checklist

After setup, verify these work:

- [ ] Seller can register (no errors)
- [ ] Seller record appears in `shop_sellers` table
- [ ] Admin can view sellers in admin dashboard
- [ ] Admin can approve sellers
- [ ] Approved seller can login to seller dashboard
- [ ] Seller can add products with images
- [ ] Products appear in shop catalog
- [ ] Buyers can browse and purchase products
- [ ] Orders create successfully
- [ ] Categories display correctly

---

## 🎯 Quick Fix Commands

If you need to reset or fix specific issues:

### Reset Sellers Table
```sql
-- Delete all seller records
DELETE FROM shop_sellers;

-- Reset to allow new registrations
ALTER TABLE shop_sellers DISABLE ROW LEVEL SECURITY;
ALTER TABLE shop_sellers ENABLE ROW LEVEL SECURITY;
```

### View All Sellers (including unapproved)
```sql
SELECT * FROM shop_sellers ORDER BY created_at DESC;
```

### Manually Approve All Sellers
```sql
UPDATE shop_sellers SET is_approved = true WHERE is_approved = false;
```

### Check RLS Policies
```sql
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual 
FROM pg_policies 
WHERE tablename = 'shop_sellers';
```

---

## 📞 Still Having Issues?

1. Check browser console for detailed error messages
2. Check Supabase logs: Dashboard → Logs
3. Verify environment variables in `.env.local`
4. Make sure Supabase client is initialized
5. Try with a fresh email address (not previously registered)

---

**Last Updated**: After Deep System Scan  
**Status**: Schema updated with shop_sellers table ✅
