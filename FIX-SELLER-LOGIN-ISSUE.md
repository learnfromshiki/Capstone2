# Fix: "Invalid Login Credentials" for Seller

## 🔍 Problem

Seller "Pawganic" is approved in the admin dashboard, but when trying to login at `/shop`, they get:
```
❌ Invalid login credentials
```

## 🎯 Root Cause

The seller exists in the `shop_sellers` table but either:
1. **No corresponding user** in Supabase Auth (`auth.users`)
2. **Wrong password** being used
3. **Email not verified** (if email confirmation is required)

## ✅ Solution (Choose One)

### Option 1: Check If User Exists in Supabase Auth

Run this in Supabase SQL Editor:

```sql
-- Check if the seller has a corresponding auth user
SELECT 
  s.business_name,
  s.contact_email,
  s.user_id,
  u.email as auth_email,
  u.email_confirmed_at,
  u.created_at
FROM shop_sellers s
LEFT JOIN auth.users u ON s.user_id = u.id
WHERE s.contact_email = 'jedbusinos@gmail.com';
```

**If `auth_email` is NULL** → User doesn't exist in Auth (see Option 2)  
**If `email_confirmed_at` is NULL** → Email not verified (see Option 3)  
**If user exists** → Password is wrong (see Option 4)

---

### Option 2: Create Missing Auth User

If the seller registered but the auth user wasn't created:

```sql
-- Manually create auth user (replace with actual password)
-- This requires superuser access or use Supabase Dashboard

-- Go to Authentication → Users → Add User
Email: jedbusinos@gmail.com
Password: (set a new password)
Auto Confirm: YES (check this box)

-- Then link to shop_sellers:
UPDATE shop_sellers
SET user_id = 'NEW_USER_ID_FROM_AUTH'
WHERE contact_email = 'jedbusinos@gmail.com';
```

---

### Option 3: Verify Email (If Confirmation Required)

If email confirmation is enabled:

**Method A - Disable Email Confirmation (Development)**
1. Go to Supabase Dashboard
2. Authentication → Settings
3. Find "Confirm email"
4. Toggle **OFF**
5. Save

**Method B - Manually Confirm Email**
```sql
UPDATE auth.users
SET email_confirmed_at = now()
WHERE email = 'jedbusinos@gmail.com';
```

---

### Option 4: Reset Password

If the user exists but password is wrong:

**In Supabase Dashboard:**
1. Go to **Authentication** → **Users**
2. Find user: `jedbusinos@gmail.com`
3. Click **"..."** → **Reset Password**
4. Set new password
5. Tell seller the new password

**Or use SQL:**
```sql
-- This requires generating a password hash
-- Easier to use dashboard above
```

---

## 🧪 Test Login After Fix

### Step 1: Go to Shop
Navigate to: `https://your-vercel-url.vercel.app/shop`

### Step 2: Click "Sign In"
Click the sign in button in the header

### Step 3: Try Logging In
- Email: `jedbusinos@gmail.com`
- Password: (use the password you set/reset)

**Expected Result:** ✅ Redirects to seller dashboard

---

## 🎨 Improved Admin UI (Committed: f6eaf4a)

The admin sellers table now shows:

### Before Approval:
```
Business: Pawganic
Status: Pending Approval (yellow)
Actions: [Approve] [Suspend]
```

### After Approval:
```
Business: Pawganic
Status: Active (green)
Actions: [Approved ✓] [Suspend]
```

### After Suspension:
```
Business: Pawganic
Status: Suspended (red)
Actions: [Approved ✓] [Activate]
```

**Changes:**
- ✅ Better status labels: "Active", "Pending Approval", "Suspended"
- ✅ "Approved ✓" placeholder when already approved
- ✅ Confirmation dialog before suspend/activate
- ✅ Approve button sets both `is_approved = true` AND `is_active = true`
- ✅ Larger, more visible action buttons

---

## 📋 Complete Registration-to-Login Flow

### 1. Seller Registers
- Goes to `/shop` → Sign In → Seller
- Fills form with email + password
- Clicks "Sign Up"

**Creates:**
- Entry in `auth.users` (Supabase Auth)
- Entry in `shop_sellers` (with `is_approved = false`)

### 2. Admin Approves
- Admin logs in
- Goes to Sellers tab
- Clicks "Approve" button

**Updates:**
- `shop_sellers.is_approved = true`
- `shop_sellers.is_active = true`

### 3. Seller Logs In
- Goes to `/shop` → Sign In
- Enters email + password
- Clicks "Log In"

**Checks:**
1. Email/password matches `auth.users`
2. User exists in `shop_sellers`
3. `is_approved = true`
4. Redirects to seller dashboard

---

## 🔧 Debug Checklist

Run these queries to diagnose:

### 1. Check seller record
```sql
SELECT * FROM shop_sellers 
WHERE contact_email = 'jedbusinos@gmail.com';
```

### 2. Check auth user
```sql
SELECT id, email, email_confirmed_at, created_at 
FROM auth.users 
WHERE email = 'jedbusinos@gmail.com';
```

### 3. Check if linked
```sql
SELECT 
  s.business_name,
  s.is_approved,
  s.is_active,
  s.user_id,
  u.id as auth_id,
  CASE 
    WHEN u.id IS NULL THEN '❌ NO AUTH USER'
    WHEN s.user_id != u.id THEN '❌ WRONG USER_ID'
    ELSE '✅ LINKED'
  END as status
FROM shop_sellers s
LEFT JOIN auth.users u ON s.user_id = u.id
WHERE s.contact_email = 'jedbusinos@gmail.com';
```

---

## 🚀 Quick Fix Script

Run this to fix common issues:

```sql
-- 1. Find the auth user
DO $$
DECLARE
  auth_user_id uuid;
  seller_id uuid;
BEGIN
  -- Get auth user ID
  SELECT id INTO auth_user_id
  FROM auth.users
  WHERE email = 'jedbusinos@gmail.com';
  
  -- Get seller ID
  SELECT id INTO seller_id
  FROM shop_sellers
  WHERE contact_email = 'jedbusinos@gmail.com';
  
  IF auth_user_id IS NULL THEN
    RAISE NOTICE '❌ No auth user found for jedbusinos@gmail.com';
    RAISE NOTICE 'Create user in Authentication > Users';
  ELSIF seller_id IS NULL THEN
    RAISE NOTICE '❌ No seller record found';
  ELSE
    -- Link them
    UPDATE shop_sellers
    SET user_id = auth_user_id,
        is_approved = true,
        is_active = true
    WHERE id = seller_id;
    
    -- Confirm email
    UPDATE auth.users
    SET email_confirmed_at = COALESCE(email_confirmed_at, now())
    WHERE id = auth_user_id;
    
    RAISE NOTICE '✅ Seller linked and approved';
    RAISE NOTICE 'User ID: %', auth_user_id;
    RAISE NOTICE 'Seller can now login!';
  END IF;
END $$;
```

---

## ✅ After Fix

Once fixed, the seller should be able to:
1. ✅ Login at `/shop` with their email/password
2. ✅ Get redirected to `/shop/seller/dashboard`
3. ✅ See their dashboard with stats
4. ✅ Add products, manage orders

---

**Committed**: `f6eaf4a` - Improved admin seller management UI  
**Next Step**: Run diagnostic queries above to identify the exact issue
