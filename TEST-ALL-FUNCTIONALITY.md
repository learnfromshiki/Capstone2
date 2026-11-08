# Complete Functionality Test Guide
**System**: E-Commerce Platform with Admin, Seller, and Buyer Dashboards  
**Test Date**: Ready for Testing  
**Build Status**: ✅ Production Ready

---

## 🚀 Quick Start

### 1. Start Development Server
```bash
npm run dev
```
**Expected**: Server starts at http://localhost:3000

### 2. Verify Environment
✅ `.env.local` exists with Supabase credentials  
✅ Dev server runs without errors  
✅ No console errors on page load

---

## 🧪 Test Scenarios

### Test Suite 1: Admin Dashboard ⭐

#### **Access Admin Dashboard**
1. Navigate to: http://localhost:3000/shop/admin
2. Enter credentials:
   - **Email**: `shiki@gmail.com`
   - **Password**: `shiki1234`
3. Click "Sign In"

**Expected Results**:
- ✅ Login successful
- ✅ Redirected to admin dashboard
- ✅ Purple sidebar visible on left
- ✅ Dashboard stats displayed (Total Orders, Total Revenue, Pending Sellers, Total Products)

#### **Test Dashboard Tab**
1. Verify "Dashboard" tab is active (purple highlight)
2. Check widgets present:
   - Quick Actions (4 buttons)
   - Pending Approvals widget
   - Recent Orders table
   - Sales Overview chart

**Expected Results**:
- ✅ All widgets render without errors
- ✅ Stats show correct numbers from database
- ✅ Quick Actions buttons are clickable

#### **Test Orders Tab**
1. Click "Orders" in sidebar
2. Verify order list displays
3. Try changing order status dropdown

**Expected Results**:
- ✅ Orders load from database
- ✅ Can view order details
- ✅ Status updates save to database

#### **Test Products Tab**
1. Click "Products" in sidebar
2. Click "Add Product" button
3. Fill in product form:
   - Name: Test Product
   - Price: 199.99
   - Stock: 50
   - Category: Handicrafts
   - Description: Test description
4. Upload test image (JPG/PNG, max 5MB)
5. Click "Add Product"

**Expected Results**:
- ✅ Image upload shows progress
- ✅ Image uploads to Supabase Storage
- ✅ Product added successfully
- ✅ Product appears in products list
- ✅ Image displays correctly

#### **Test Sellers Tab**
1. Click "Sellers" in sidebar
2. View registered sellers
3. Check approval status
4. Try approving/rejecting a seller

**Expected Results**:
- ✅ Sellers list loads
- ✅ Can see business name, email, status
- ✅ Approval buttons work
- ✅ Status updates reflect immediately

#### **Test Customers Tab**
1. Click "Customers" in sidebar
2. View customer list

**Expected Results**:
- ✅ Customers load from profiles table
- ✅ Shows name, email, role
- ✅ No errors in console

#### **Test Categories Tab**
1. Click "Categories" in sidebar
2. Click "Add Category" button
3. Fill in:
   - Name: Test Category
   - Icon: 🎨 (emoji)
   - Slug: test-category
4. Click "Add Category"

**Expected Results**:
- ✅ Category added successfully
- ✅ Appears in categories list
- ✅ Can be used when adding products

#### **Test Transactions Tab**
1. Click "Transactions" in sidebar
2. View payment breakdown (COD vs GCash)
3. Check transaction history table

**Expected Results**:
- ✅ Payment totals calculate correctly
- ✅ Transaction list displays
- ✅ Shows order ID, date, amount, method

#### **Test Reports Tab**
1. Click "Reports" in sidebar
2. View sales analytics
3. Check revenue summary

**Expected Results**:
- ✅ Reports load without errors
- ✅ Data aggregates correctly
- ✅ Charts/stats display properly

#### **Test Settings Tab**
1. Click "Settings" in sidebar
2. View system settings

**Expected Results**:
- ✅ Settings interface loads
- ✅ No console errors

---

### Test Suite 2: Seller Dashboard 🏪

#### **Register New Seller**
1. Navigate to: http://localhost:3000/shop
2. Click "Sign In" in header
3. Select "Seller" card
4. Fill in registration:
   - Shop Name: Test Shop
   - Email: testseller@test.com
   - Password: test1234
   - Phone: 09123456789 (optional)
5. Click "Sign Up"

**Expected Results**:
- ✅ Registration successful
- ✅ Seller account created in `shop_sellers` table
- ✅ Status: "Pending Approval"
- ✅ Redirected to seller page

#### **Admin Approves Seller**
1. Admin logs in
2. Goes to Sellers tab
3. Finds "Test Shop"
4. Clicks "Approve"

**Expected Results**:
- ✅ Seller status changes to "Approved"
- ✅ `is_approved` = true in database

#### **Seller Logs In**
1. Navigate to: http://localhost:3000/shop/seller/dashboard
2. Enter credentials:
   - Email: testseller@test.com
   - Password: test1234
3. Click "Sign In"

**Expected Results**:
- ✅ Login successful
- ✅ Dashboard loads with purple sidebar
- ✅ Stats cards display (Total Products, Total Orders, Total Revenue)

#### **Test Seller Dashboard Tab**
1. Verify Dashboard tab is active
2. Check widgets:
   - Quick Actions (3 buttons)
   - Recent Orders table
   - Shop Information widget

**Expected Results**:
- ✅ All widgets render
- ✅ Shop name and rating displayed
- ✅ Quick Actions functional

#### **Test My Products Tab**
1. Click "My Products" in sidebar
2. Click "Add Product" button
3. Fill in product form:
   - Name: Seller Test Product
   - Price: 299.99
   - Stock: 100
   - Category: Handicrafts
   - Description: Handmade item
4. Upload product image
5. Click "Add Product"

**Expected Results**:
- ✅ Image uploads successfully
- ✅ Product created and linked to seller
- ✅ Product appears in seller's product list
- ✅ Product status: Available

#### **Test Product Management**
1. Find newly added product
2. Toggle "Available" switch to OFF
3. Toggle back to ON
4. Click "Delete" button
5. Confirm deletion

**Expected Results**:
- ✅ Availability toggles update database
- ✅ Product can be deleted
- ✅ Deleted product removed from list

#### **Test Orders Tab**
1. Click "Orders" in sidebar
2. View orders for this seller's products

**Expected Results**:
- ✅ Orders filtered to seller's products only
- ✅ Can view order details
- ✅ Can update order status

#### **Test Sales & Earnings Tab**
1. Click "Sales & Earnings"
2. View revenue stats
3. Check earnings breakdown

**Expected Results**:
- ✅ Total earnings calculated correctly
- ✅ Shows revenue over time
- ✅ Pending vs completed earnings

#### **Test Shop Settings Tab**
1. Click "Shop Settings"
2. Update business information
3. Save changes

**Expected Results**:
- ✅ Settings form loads current data
- ✅ Changes save to database
- ✅ Success message displayed

#### **Test Profile Tab**
1. Click "Profile"
2. Update contact information
3. Save profile

**Expected Results**:
- ✅ Profile data loads
- ✅ Updates save successfully
- ✅ Changes reflected in database

---

### Test Suite 3: Buyer Experience 🛍️

#### **Browse Products (No Login)**
1. Navigate to: http://localhost:3000/shop
2. View product catalog
3. Use search bar
4. Filter by category

**Expected Results**:
- ✅ Products display in grid
- ✅ Search filters products
- ✅ Category tabs work
- ✅ Product cards show image, name, price
- ✅ Can browse without logging in

#### **Register as Buyer**
1. Click "Sign In" in header
2. Select "Buyer" card
3. Fill in registration:
   - Email: testbuyer@test.com
   - Password: test1234
4. Click "Sign Up"

**Expected Results**:
- ✅ Registration successful
- ✅ Buyer account created
- ✅ Automatically logged in
- ✅ Redirected back to shop

#### **Add to Cart**
1. Browse products
2. Click "Add to Cart" on a product
3. Verify cart icon updates with count
4. Click cart icon to view cart

**Expected Results**:
- ✅ Product added to cart
- ✅ Cart count increments
- ✅ Cart modal opens
- ✅ Product shows in cart with quantity

#### **Cart Management**
1. Open cart modal
2. Increase quantity with + button
3. Decrease quantity with - button
4. Remove item with trash icon
5. Add multiple different products

**Expected Results**:
- ✅ Quantity updates correctly
- ✅ Total price recalculates
- ✅ Remove item works
- ✅ Multiple products in cart
- ✅ Cart persists in localStorage

#### **Stock Validation**
1. Find a product with limited stock
2. Try adding more than available stock

**Expected Results**:
- ✅ Alert: "Cannot add more. Only X in stock"
- ✅ Quantity capped at stock limit
- ✅ No overselling allowed

#### **Checkout Process**
1. Open cart with items
2. Click "Proceed to Checkout"
3. Fill in contact information:
   - Full Name: Test Buyer
   - Email: testbuyer@test.com
   - Phone: 09123456789
   - Address: 123 Test St, Test City
4. Click "Continue"
5. Select payment method (GCash or COD)
6. Add optional notes
7. Click "Place Order"

**Expected Results**:
- ✅ Checkout modal opens (Step 1: Contact Info)
- ✅ Form validation works
- ✅ Proceeds to Step 2: Payment
- ✅ Order created in database
- ✅ Stock quantities decremented
- ✅ Order items saved
- ✅ Success message displayed (Step 3)
- ✅ Cart clears after successful order

#### **Access Buyer Dashboard**
1. Click "My Account" or navigate to: http://localhost:3000/shop/buyer
2. Login if needed

**Expected Results**:
- ✅ Buyer dashboard loads
- ✅ Purple sidebar visible
- ✅ 8 menu items present

#### **Test My Orders Tab**
1. Click "My Orders" (should be default)
2. View order tracking widget
3. Click on an order to view details

**Expected Results**:
- ✅ Orders displayed with status
- ✅ Order tracking stats: To Pay, To Ship, To Receive, Completed
- ✅ Order details show items, total, status
- ✅ Order ID, date visible

#### **Test My Cart Tab**
1. Click "My Cart"
2. View current cart items
3. Update quantities
4. Proceed to checkout

**Expected Results**:
- ✅ Cart syncs with header cart
- ✅ Can manage cart from dashboard
- ✅ Checkout flow works

#### **Test Wishlist Tab**
1. Click "Wishlist"
2. (Feature placeholder - may show empty)

**Expected Results**:
- ✅ Tab loads without errors
- ✅ Ready for future wishlist implementation

#### **Test My Reviews Tab**
1. Click "My Reviews"
2. (Feature placeholder - may show empty)

**Expected Results**:
- ✅ Tab loads without errors
- ✅ Ready for future review implementation

#### **Test My Profile Tab**
1. Click "My Profile"
2. Update profile information
3. Save changes

**Expected Results**:
- ✅ Profile form loads user data
- ✅ Updates save to profiles table
- ✅ Success message shown

#### **Test Settings Tab**
1. Click "Settings"
2. View available settings

**Expected Results**:
- ✅ Settings interface loads
- ✅ No console errors

---

## 🔍 Technical Validation Tests

### Database Connection Test
1. Open browser DevTools (F12)
2. Go to Console tab
3. Navigate to shop page
4. Look for: "Successfully loaded X products"

**Expected Results**:
- ✅ No "Error fetching products" messages
- ✅ Products count shown
- ✅ No Supabase connection errors

### Image Upload Test
1. Prepare test images:
   - Valid: test.jpg (< 5MB)
   - Invalid: test.txt (wrong type)
   - Invalid: large.jpg (> 5MB)
2. Try uploading each in admin/seller product add

**Expected Results**:
- ✅ Valid image uploads successfully
- ✅ Invalid type rejected with error message
- ✅ Large file rejected with error message
- ✅ Image accessible via public URL
- ✅ Image displays in product list

### Stock Management Test
1. Create product with stock = 2
2. As buyer, add 2 to cart
3. Try adding one more

**Expected Results**:
- ✅ Can add up to stock limit
- ✅ Alert when trying to exceed stock
- ✅ During checkout, stock validated again
- ✅ After order, stock decremented to 0
- ✅ Product shows "Out of Stock"

### Error Handling Test
1. Temporarily rename `.env.local` to `.env.local.backup`
2. Restart dev server
3. Navigate to shop page
4. Check console

**Expected Results**:
- ✅ Error message: "Supabase client is not initialized"
- ✅ App doesn't crash
- ✅ Graceful degradation

5. Rename `.env.local.backup` back to `.env.local`
6. Restart dev server

### Responsive Design Test
1. Open DevTools (F12)
2. Toggle device toolbar (Ctrl+Shift+M)
3. Test on:
   - Mobile (375px)
   - Tablet (768px)
   - Desktop (1920px)

**Expected Results**:
- ✅ Sidebar collapses on mobile
- ✅ Product grid responsive (1/2/3/4 columns)
- ✅ Forms usable on mobile
- ✅ Buttons properly sized for touch
- ✅ No horizontal scroll

---

## 📊 Performance Tests

### Page Load Test
1. Open DevTools Network tab
2. Reload shop page
3. Check load times

**Expected Benchmarks**:
- ✅ First Load JS: ~180KB (within budget)
- ✅ Page interactive: < 3 seconds
- ✅ Images load progressively

### Bundle Size Test
```bash
npm run build
```

**Expected Results**:
- ✅ All pages compile successfully
- ✅ /shop: ~13KB
- ✅ /shop/admin: ~11KB
- ✅ /shop/buyer: ~5KB
- ✅ /shop/seller/dashboard: ~9KB

---

## 🔒 Security Tests

### Authentication Test
1. Try accessing admin without login: http://localhost:3000/shop/admin
2. Try accessing seller dashboard without login
3. Try accessing buyer dashboard without login

**Expected Results**:
- ✅ Redirected to login or shows login form
- ✅ Cannot access protected routes
- ✅ Session persists across page reloads

### Authorization Test
1. Login as Seller
2. Try to access admin URL: http://localhost:3000/shop/admin

**Expected Results**:
- ✅ Access denied or redirected
- ✅ Seller can only access seller routes

### SQL Injection Test
1. In product search, try: `'; DROP TABLE shop_products; --`
2. In login form, try: `admin@test.com' OR '1'='1`

**Expected Results**:
- ✅ No SQL execution (Supabase parameterizes queries)
- ✅ Treated as literal search string
- ✅ No database damage

### XSS Test
1. Try adding product with name: `<script>alert('XSS')</script>`
2. View product in catalog

**Expected Results**:
- ✅ Script not executed
- ✅ Displayed as plain text
- ✅ React escapes HTML by default

---

## ✅ Pass Criteria

### Critical (Must Pass)
- [ ] Build compiles without errors
- [ ] All 3 dashboards accessible
- [ ] Admin can login with shiki@gmail.com
- [ ] Seller can register and login
- [ ] Buyer can browse, add to cart, checkout
- [ ] Products display correctly
- [ ] Orders create successfully
- [ ] Stock updates correctly
- [ ] Images upload and display
- [ ] No console errors on any page

### Important (Should Pass)
- [ ] Responsive on mobile/tablet/desktop
- [ ] Search and filters work
- [ ] Category management works
- [ ] Seller approval flow works
- [ ] Order status updates work
- [ ] Profile updates save
- [ ] Cart persists in localStorage
- [ ] Payment method selection works

### Nice to Have (Good to Pass)
- [ ] Image optimization warnings resolved
- [ ] Load times under 2 seconds
- [ ] Smooth animations
- [ ] Proper loading states
- [ ] Toast notifications for actions

---

## 🐛 Bug Reporting Template

If you find any issues, document them as follows:

```markdown
### Bug #X: [Title]
**Severity**: Critical / High / Medium / Low
**Component**: Admin / Seller / Buyer / Shared
**Steps to Reproduce**:
1. 
2. 
3. 

**Expected Result**:

**Actual Result**:

**Console Errors** (if any):

**Screenshots**:
```

---

## 📝 Test Results Summary

Fill in after testing:

```
Date Tested: ___________
Tester: ___________

Critical Tests: __ / __ passed
Important Tests: __ / __ passed
Nice to Have: __ / __ passed

Bugs Found: __
- Critical: __
- High: __
- Medium: __
- Low: __

Overall Status: ✅ PASS / ❌ FAIL / ⚠️ NEEDS WORK
```

---

## 🎯 Ready for Production?

### Deployment Checklist
- [ ] All critical tests passed
- [ ] Database schemas deployed to Supabase
- [ ] Storage bucket created and configured
- [ ] Environment variables set in production
- [ ] Admin account exists in production database
- [ ] Build succeeds on production
- [ ] Smoke test completed on production URL

**If all checked**: 🎉 **READY FOR PRODUCTION DEPLOYMENT**

