# Complete System Testing Guide

## 🎯 Testing Overview

This guide provides step-by-step instructions to test all functionalities of the CONNECT-Daet e-commerce system.

---

## 📋 Pre-Testing Setup

### 1. Database Setup
```bash
# Run the complete database setup script in Supabase SQL Editor:
DATABASE-SETUP-COMPLETE.sql
```

### 2. Start Development Server
```bash
npm run dev
# Server should start on http://localhost:3000 or 3001
```

### 3. Environment Variables
Verify `.env.local` exists with:
```
NEXT_PUBLIC_SUPABASE_URL=your_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
```

---

## 🛍️ CUSTOMER FLOW TESTING

### Test 1: Browse Products
**Steps:**
1. Navigate to `http://localhost:3001/shop`
2. Verify products load and display
3. Check product cards show: image, name, price, stock, category, artisan

**Expected Results:**
- ✅ 10 sample products display
- ✅ Product images or placeholders show
- ✅ Prices formatted as ₱XXX.XX
- ✅ Stock numbers visible
- ✅ Category badges colored correctly

**Status:** □ Pass □ Fail

---

### Test 2: Category Filtering
**Steps:**
1. On shop page, click category tabs: All, Handicrafts, Food, Souvenirs, Weavings, Art
2. Verify products filter correctly
3. Check product count updates

**Expected Results:**
- ✅ Only products from selected category show
- ✅ "All Products" shows everything
- ✅ Product count displays correctly
- ✅ Active tab highlighted

**Status:** □ Pass □ Fail

---

### Test 3: Product Search
**Steps:**
1. Type "bag" in search box
2. Verify "Handwoven Abaca Bag" appears
3. Type "Maria Santos" (artisan name)
4. Verify products by that artisan show
5. Clear search

**Expected Results:**
- ✅ Search matches product names
- ✅ Search matches descriptions
- ✅ Search matches artisan names
- ✅ Search is case-insensitive
- ✅ Clear button works

**Status:** □ Pass □ Fail

---

### Test 4: Customer Signup
**Steps:**
1. Click "Sign In" button
2. Click "Don't have an account? Sign up"
3. Select "Customer" account type
4. Fill form:
   - Full Name: Test Customer
   - Email: test@example.com
   - Password: test123456
5. Submit form

**Expected Results:**
- ✅ Modal shows customer/seller selector
- ✅ Customer option highlighted when selected
- ✅ Only basic fields show (name, email, password)
- ✅ Success message appears
- ✅ Instructions to check email

**Status:** □ Pass □ Fail

---

### Test 5: Customer Login
**Steps:**
1. Click "Sign In"
2. Enter email: test@example.com
3. Enter password: test123456
4. Click "Sign In"

**Expected Results:**
- ✅ Modal closes
- ✅ User email appears in header
- ✅ "Logout" button visible
- ✅ No errors

**Status:** □ Pass □ Fail

---

### Test 6: Add to Cart (Out of Stock)
**Steps:**
1. Find a product with 0 stock (or set stock to 0 in admin)
2. Click "Add to Cart" button

**Expected Results:**
- ✅ Button disabled if stock is 0
- ✅ Alert shows "Sorry, this product is out of stock"
- ✅ Item NOT added to cart

**Status:** □ Pass □ Fail

---

### Test 7: Add to Cart (In Stock)
**Steps:**
1. Click "Add to Cart" on product with stock
2. Verify cart icon updates
3. Cart drawer opens briefly

**Expected Results:**
- ✅ Cart count badge shows "1"
- ✅ Cart drawer opens for 2 seconds
- ✅ Product appears in cart
- ✅ Quantity set to 1

**Status:** □ Pass □ Fail

---

### Test 8: Cart Persistence
**Steps:**
1. Add 2 products to cart
2. Refresh the page (F5)
3. Check cart

**Expected Results:**
- ✅ Cart still contains 2 products
- ✅ Quantities preserved
- ✅ Cart count badge correct

**Status:** □ Pass □ Fail

---

### Test 9: Cart Quantity Management
**Steps:**
1. Open cart drawer
2. Increase quantity with "+" button
3. Decrease quantity with "-" button
4. Try to exceed available stock

**Expected Results:**
- ✅ Quantity increases/decreases
- ✅ Total updates correctly
- ✅ Cannot exceed available stock
- ✅ Alert if trying to exceed stock

**Status:** □ Pass □ Fail

---

### Test 10: Remove from Cart
**Steps:**
1. Open cart
2. Click remove button (trash icon) on item

**Expected Results:**
- ✅ Item removed from cart
- ✅ Total updates
- ✅ Cart count decreases
- ✅ If last item, cart shows empty state

**Status:** □ Pass □ Fail

---

### Test 11: Checkout Flow - Contact Info
**Steps:**
1. Add items to cart
2. Click "Checkout" button
3. Fill contact form:
   - Full Name: Test Customer
   - Email: test@example.com
   - Phone: 09123456789
   - Address: 123 Test St, Daet
4. Click "Continue"

**Expected Results:**
- ✅ Checkout modal opens
- ✅ Step 1 (Contact Info) shows
- ✅ All fields required
- ✅ Email format validated
- ✅ Advances to payment step

**Status:** □ Pass □ Fail

---

### Test 12: Checkout Flow - Payment
**Steps:**
1. On payment step
2. Select payment method: GCash / COD / Bank Transfer
3. Add optional notes
4. Click "Place Order"

**Expected Results:**
- ✅ Three payment options show
- ✅ Can select any option
- ✅ Notes field optional
- ✅ "Place Order" button enabled

**Status:** □ Pass □ Fail

---

### Test 13: Order Creation & Stock Update
**Steps:**
1. Complete checkout with 1x product (quantity 1)
2. Note current stock before checkout
3. Complete order
4. Check product stock after

**Expected Results:**
- ✅ Order created in database
- ✅ Stock decreased by quantity ordered
- ✅ Success message shows
- ✅ Order ID displayed

**Status:** □ Pass □ Fail

---

### Test 14: Stock Validation at Checkout
**Steps:**
1. Add product to cart (quantity 5)
2. In separate tab, admin reduces stock to 2
3. Try to checkout original cart

**Expected Results:**
- ✅ Checkout detects insufficient stock
- ✅ Error message shows specific product and available stock
- ✅ Order NOT created
- ✅ Stock NOT updated

**Status:** □ Pass □ Fail

---

### Test 15: Rewards Points (if profiles table exists)
**Steps:**
1. Complete order worth ₱500
2. Check profiles table for user's points

**Expected Results:**
- ✅ Points calculated: ₱500 / 100 * 10 = 50 points
- ✅ Profile updated with correct points
- ✅ Reward history record created
- ✅ Source set to 'shop_purchase'

**Status:** □ Pass □ Fail

---

## 🏪 SELLER FLOW TESTING

### Test 16: Seller Signup
**Steps:**
1. Logout if logged in
2. Click "Sign In" → "Sign up"
3. Select "Seller" account type
4. Fill form:
   - Contact Name: Test Seller
   - Business Name: Test Shop
   - Email: seller@example.com
   - Password: seller123
   - Phone: 09987654321
   - Address: 456 Business St

**Expected Results:**
- ✅ Seller option highlighted
- ✅ Additional fields appear (business name, phone, address)
- ✅ Yellow warning box shows approval required
- ✅ Success message mentions approval
- ✅ Seller record created in shop_sellers with is_approved=false

**Status:** □ Pass □ Fail

---

### Test 17: Seller Login (Before Approval)
**Steps:**
1. Login as seller@example.com
2. Navigate to `/shop/seller`

**Expected Results:**
- ✅ Login successful
- ✅ Seller dashboard shows "pending approval" message
- ✅ Cannot access product management
- ✅ Professional UI with lock icon

**Status:** □ Pass □ Fail

---

### Test 18: Admin Approves Seller (Manual)
**Steps:**
1. In Supabase SQL Editor, run:
```sql
UPDATE shop_sellers
SET is_approved = true
WHERE contact_email = 'seller@example.com';
```
2. Refresh seller dashboard

**Expected Results:**
- ✅ Approval status updated
- ✅ Seller can now access dashboard
- ✅ Product management available

**Status:** □ Pass □ Fail

---

### Test 19: Seller Add Product
**Steps:**
1. On seller dashboard, click "Add Product"
2. Fill form:
   - Name: Test Product
   - Description: Test description
   - Price: 100
   - Stock: 10
   - Category: Handicrafts
   - Image URL: (any valid URL)
3. Submit

**Expected Results:**
- ✅ Product created
- ✅ seller_id set correctly
- ✅ Product appears in seller's list
- ✅ Product visible in shop (if available=true)

**Status:** □ Pass □ Fail

---

### Test 20: Seller Product Validation
**Steps:**
1. Try to create product with:
   - Price: 0
   - Price: -10
   - Stock: -5

**Expected Results:**
- ✅ Price 0: Error shown
- ✅ Price -10: Prevented by min="0.01"
- ✅ Stock -5: Prevented by min="0"
- ✅ Form does not submit

**Status:** □ Pass □ Fail

---

### Test 21: Seller View Earnings
**Steps:**
1. Create order containing seller's product
2. Mark order as "delivered" in admin
3. Check seller earnings tab

**Expected Results:**
- ✅ Earnings record created
- ✅ 15% commission deducted
- ✅ Status changed from "pending" to "paid"
- ✅ paid_at timestamp set

**Status:** □ Pass □ Fail

---

## 🔐 ADMIN FLOW TESTING

### Test 22: Admin Login (Shop Modal)
**Steps:**
1. Go to `/shop`
2. Click "Sign In"
3. Enter: shiki@gmail.com / (private: see ADMIN-CREDENTIALS.md)
4. Submit

**Expected Results:**
- ✅ Detects admin credentials
- ✅ Redirects to `/shop/admin`
- ✅ No regular shop access
- ✅ Session stored

**Status:** □ Pass □ Fail

---

### Test 23: Admin Login (Direct)
**Steps:**
1. Navigate directly to `/shop/admin`
2. Enter: shiki@gmail.com / (private: see ADMIN-CREDENTIALS.md)
3. Click "Access Admin Panel"

**Expected Results:**
- ✅ Login screen shows
- ✅ Requires both email and password
- ✅ Incorrect credentials rejected
- ✅ Correct credentials grant access

**Status:** □ Pass □ Fail

---

### Test 24: Admin Dashboard Stats
**Steps:**
1. Login to admin
2. View dashboard cards

**Expected Results:**
- ✅ Total Products count accurate
- ✅ Total Orders count accurate
- ✅ Revenue calculated correctly
- ✅ Stats update in real-time

**Status:** □ Pass □ Fail

---

### Test 25: Admin Add Product
**Steps:**
1. Click "Add Product"
2. Fill all fields
3. Try invalid values (price=0, stock=-1)
4. Submit with valid values

**Expected Results:**
- ✅ Modal opens with form
- ✅ Validation prevents invalid values
- ✅ Product created successfully
- ✅ Appears in product list immediately

**Status:** □ Pass □ Fail

---

### Test 26: Admin Product Search
**Steps:**
1. Type product name in search
2. Verify filtering works
3. Clear search

**Expected Results:**
- ✅ Products filtered in real-time
- ✅ Search matches name and artisan
- ✅ Case-insensitive
- ✅ Clear works

**Status:** □ Pass □ Fail

---

### Test 27: Admin Toggle Product Availability
**Steps:**
1. Click "Deactivate" on active product
2. Check shop page
3. Click "Activate" to restore

**Expected Results:**
- ✅ Status changes to inactive
- ✅ Product no longer visible in shop
- ✅ Badge shows "Inactive"
- ✅ Reactivation works

**Status:** □ Pass □ Fail

---

### Test 28: Admin Delete Product
**Steps:**
1. Click "Delete" on product
2. Confirm deletion

**Expected Results:**
- ✅ Confirmation dialog shows
- ✅ Product removed from database
- ✅ No longer in admin list
- ✅ Not visible in shop

**Status:** □ Pass □ Fail

---

### Test 29: Admin View Orders
**Steps:**
1. Switch to "Orders" tab
2. Review order list

**Expected Results:**
- ✅ All orders displayed
- ✅ Customer info visible
- ✅ Order items listed
- ✅ Total amount shown
- ✅ Payment method displayed

**Status:** □ Pass □ Fail

---

### Test 30: Admin Update Order Status
**Steps:**
1. Select an order
2. Change status from dropdown:
   - pending → confirmed → processing → shipped → delivered
3. Verify each change

**Expected Results:**
- ✅ Dropdown shows all statuses
- ✅ Status updates in database
- ✅ If "delivered", seller earnings marked as "paid"
- ✅ Updated timestamp changes

**Status:** □ Pass □ Fail

---

## 🔧 TECHNICAL TESTING

### Test 31: Database Constraints
**Steps:**
In Supabase SQL Editor, try:
```sql
-- Test price constraint
INSERT INTO shop_products (name, price, stock, category) 
VALUES ('Test', -10, 5, 'food');

-- Test stock constraint
INSERT INTO shop_products (name, price, stock, category) 
VALUES ('Test', 100, -5, 'food');

-- Test quantity constraint
INSERT INTO shop_order_items (order_id, product_name, quantity, price) 
VALUES ('00000000-0000-0000-0000-000000000000', 'Test', 0, 100);
```

**Expected Results:**
- ✅ All inserts FAIL with constraint violations
- ✅ Error messages mention CHECK constraints
- ✅ Database integrity maintained

**Status:** □ Pass □ Fail

---

### Test 32: RLS Policies
**Steps:**
1. Create customer user A
2. Create customer user B  
3. User A creates order
4. User B tries to view User A's order

**Expected Results:**
- ✅ Current RLS allows viewing (testing mode)
- ✅ Profiles only accessible by owner
- ✅ Reward history only accessible by owner

**Status:** □ Pass □ Fail

---

### Test 33: Optimistic Locking (Race Condition)
**Steps:**
1. In two browser tabs, add same product (stock=5) to cart
2. Tab 1: Checkout with quantity 4
3. Tab 2: Checkout with quantity 4 (should fail)

**Expected Results:**
- ✅ Tab 1 succeeds, stock becomes 1
- ✅ Tab 2 fails with "insufficient stock" error
- ✅ Stock NOT negative
- ✅ Only one order succeeds

**Status:** □ Pass □ Fail

---

### Test 34: Cart LocalStorage
**Steps:**
1. Open DevTools → Application → Local Storage
2. Add items to cart
3. Verify `shop_cart` key exists
4. Check JSON structure

**Expected Results:**
- ✅ Key `shop_cart` present
- ✅ Contains array of cart items
- ✅ Each item has: id, name, price, quantity, stock
- ✅ Updates on every cart change

**Status:** □ Pass □ Fail

---

### Test 35: Admin Session Persistence
**Steps:**
1. Login to admin
2. Refresh page
3. Close browser and reopen
4. Navigate to `/shop/admin`

**Expected Results:**
- ✅ After refresh: still logged in
- ✅ After browser close: logged out (sessionStorage)
- ✅ Must login again after browser close

**Status:** □ Pass □ Fail

---

## 📊 TEST RESULTS SUMMARY

### Pass/Fail Counts
- Customer Flow (15 tests): ___ / 15 ✅
- Seller Flow (6 tests): ___ / 6 ✅
- Admin Flow (9 tests): ___ / 9 ✅
- Technical (5 tests): ___ / 5 ✅

### Overall Score: ___ / 35 tests passed

---

## 🐛 KNOWN ISSUES

### Critical
- [ ] No admin UI to approve sellers (manual SQL required)
- [ ] Admin credentials hardcoded
- [ ] RLS policies in testing mode (allow all)

### Medium
- [ ] No email notifications
- [ ] No image upload (URL only)
- [ ] Cart auto-opens briefly (can be annoying)

### Low
- [ ] No loading states on some buttons
- [ ] Mobile table scrolling could be better
- [ ] Missing accessibility labels

---

## ✅ TESTING CHECKLIST

Before deploying to production:
- [ ] All 35 tests pass
- [ ] Database schemas applied correctly
- [ ] Environment variables configured
- [ ] Sample data loaded
- [ ] Admin account tested
- [ ] Customer flow end-to-end tested
- [ ] Seller registration and approval tested
- [ ] Stock management verified
- [ ] Race condition test passed
- [ ] RLS policies reviewed and updated for production
- [ ] Admin credentials changed from defaults

---

**Testing Date:** ___________________  
**Tester Name:** ___________________  
**Environment:** □ Development □ Staging □ Production  
**Overall Status:** □ Pass □ Fail □ Needs Review

