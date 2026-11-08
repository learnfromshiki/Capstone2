# Seller Account System - Complete Guide

## Overview

The seller account system allows multiple sellers to register, manage their own products, and track their earnings. Each seller operates independently with their own dashboard while selling through the unified Daet Local Shop platform.

## Features

### ✅ For Sellers:
- **Registration & Authentication**: Secure signup and login system
- **Approval Workflow**: Admin must approve sellers before they can list products
- **Product Management**: Full CRUD operations (Create, Read, Update, Delete)
- **Earnings Dashboard**: Real-time tracking of sales, revenue, and commissions
- **Business Profile**: Manage business information and contact details
- **Commission-Based Model**: 15% platform fee (configurable per seller)

### ✅ For Customers:
- **Seller Information**: See which seller is offering each product
- **Search by Seller**: Find products by seller business name
- **Transparent Shopping**: Know who you're buying from

### ✅ For Admins:
- **Seller Approval**: Control which sellers can sell on the platform
- **Commission Management**: Set different commission rates per seller
- **Product Oversight**: Admin can still manage all products

## System Architecture

### Database Schema

#### Tables Created:
1. **shop_sellers** - Stores seller profiles and business information
2. **shop_seller_earnings** - Tracks earnings and commissions per order
3. **seller_dashboard_stats** (view) - Aggregated statistics for seller dashboard

#### Key Relationships:
```
shop_sellers
  ├─> shop_products (seller_id)
  └─> shop_seller_earnings (seller_id)

shop_seller_earnings
  ├─> shop_orders (order_id)
  └─> shop_order_items (order_item_id)
```

### Automatic Features:

#### Earnings Calculation Trigger
When a customer places an order, the system automatically:
1. Calculates seller earnings (sale amount - commission)
2. Creates earning record with status "pending"
3. Updates status to "paid" when order is completed
4. Updates status to "cancelled" if order is cancelled

#### Row Level Security (RLS)
- Sellers can only view/edit their own products
- Sellers can only view their own earnings
- Approved sellers can list new products
- Public can view products from approved sellers only

## Setup Instructions

### 1. Database Setup

Run the SQL schema file in your Supabase SQL editor:

```bash
# File: supabase-sellers-schema.sql
```

This creates:
- Tables (shop_sellers, shop_seller_earnings)
- RLS policies
- Automatic triggers
- Dashboard statistics view

### 2. Initial Configuration

The system is pre-configured with:
- **Commission Rate**: 15% (can be changed in shop_sellers table)
- **Approval Required**: Yes (sellers must be approved by admin)
- **Default Status**: Pending approval

### 3. Admin Approval Process

To approve a seller:

```sql
UPDATE shop_sellers
SET is_approved = true
WHERE id = 'seller-uuid-here';
```

Or create an admin interface to toggle `is_approved` status.

## User Flows

### Seller Registration Flow

1. **Seller visits**: `http://localhost:3000/shop/seller`
2. **Clicks**: "Create Seller Account"
3. **Fills form**:
   - Business Name (required)
   - Email (required)
   - Password (required, min 6 characters)
   - Phone Number (optional)
   - Business Address (optional)
   - Business Description (optional)
4. **Submits**: Account created, email verification sent
5. **Status**: Pending approval
6. **Waits**: Admin approves the seller account
7. **Approved**: Seller can now access dashboard and list products

### Seller Product Management Flow

1. **Login**: `http://localhost:3000/shop/seller`
2. **Dashboard**: Redirected to `/shop/seller/dashboard`
3. **View Stats**: Products, orders, revenue, earnings
4. **Add Product**:
   - Click "Add Product" button
   - Fill product form (name, price, stock, category, etc.)
   - Submit
5. **Edit Product**: Click "Edit" on any product card
6. **Delete Product**: Click "Delete" with confirmation
7. **Toggle Availability**: Checkbox in product form

### Customer Shopping Flow

1. **Browse Shop**: `http://localhost:3000/shop`
2. **See Seller Info**: Each product shows "Sold by [Business Name]"
3. **Search**: Can search by seller name, product name, artisan
4. **Add to Cart**: Must be logged in
5. **Checkout**: Completes order
6. **Earnings Recorded**: Seller's earnings automatically calculated

## URLs & Routes

### Seller Routes:
- **Login/Signup**: `/shop/seller`
- **Dashboard**: `/shop/seller/dashboard` (requires auth + approval)

### Customer Routes:
- **Shop**: `/shop`
- **Product Cards**: Show seller information

### Admin Routes:
- **Admin Panel**: `/shop/admin` (password: `shiki1234`)

## Commission System

### How It Works:

**Example Sale:**
- Product Price: ₱1,000
- Quantity: 2
- **Total Sale**: ₱2,000

**Commission Calculation:**
- Platform Fee: 15% = ₱300
- **Seller Earning**: ₱1,700

### Earnings Status:
- **Pending**: Order placed, awaiting completion
- **Paid**: Order completed, earnings released
- **Cancelled**: Order cancelled, no earnings

### Viewing Earnings:

Sellers can view in dashboard:
- Total sales (gross)
- Total earnings (after commission)
- Pending earnings
- Paid earnings
- Detailed transaction history

## Seller Dashboard Features

### Stats Cards:
1. **Products**: Total products, active products count
2. **Orders**: Number of orders containing seller's products
3. **Revenue**: Gross sales amount
4. **Earnings**: Net earnings after commission

### Products Tab:
- Grid view of all seller's products
- Add new product button
- Edit/Delete actions per product
- Product availability toggle
- Stock level indicators

### Earnings Tab:
- List of all earnings transactions
- Shows product name, customer, date
- Displays sale amount, commission, and net earning
- Status badges (pending/paid/cancelled)
- Commission breakdown per transaction

### Profile Tab:
- Business information display
- Contact details
- Commission rate information
- Approval status indicator

## API Integration

### Fetching Products with Seller Info:

```javascript
const { data, error } = await supabase
  .from('shop_products')
  .select(`
    *,
    shop_sellers (
      id,
      business_name,
      description
    )
  `)
  .eq('available', true);
```

### Creating Product (Seller):

```javascript
const { data, error } = await supabase
  .from('shop_products')
  .insert({
    name: 'Product Name',
    price: 100,
    stock: 50,
    seller_id: sellerProfile.id,
    // ... other fields
  });
```

### Fetching Seller Stats:

```javascript
const { data, error } = await supabase
  .from('seller_dashboard_stats')
  .select('*')
  .eq('seller_id', sellerId)
  .single();
```

## Testing Guide

### Test Seller Registration:

1. Go to `/shop/seller`
2. Click "Sign up"
3. Fill form with test data:
   ```
   Business Name: Test Shop
   Email: testshop@example.com
   Password: test123
   ```
4. Submit and verify email

### Test Approval (Manual):

Run in Supabase SQL editor:
```sql
UPDATE shop_sellers
SET is_approved = true
WHERE contact_email = 'testshop@example.com';
```

### Test Product Creation:

1. Login as seller
2. Click "Add Product"
3. Fill form:
   ```
   Name: Test Product
   Price: 99.99
   Stock: 10
   Category: handicrafts
   ```
4. Submit
5. Verify product appears in shop

### Test Customer View:

1. Go to `/shop`
2. Find the test product
3. Verify "Sold by Test Shop" badge appears
4. Search for "Test Shop" - product should appear

### Test Earnings (After Order):

1. Customer places order with seller's product
2. Go to seller dashboard
3. Click "Earnings" tab
4. Verify transaction appears with "pending" status
5. Admin marks order as "completed"
6. Refresh earnings - status should be "paid"

## Security Features

### Authentication:
- Supabase Auth for seller accounts
- Separate from customer authentication
- Session-based authentication

### Authorization (RLS):
- Sellers can only access their own data
- Sellers cannot see other sellers' products/earnings
- Sellers cannot modify other sellers' products
- Public can only view approved sellers' products

### Data Validation:
- Email verification required
- Password minimum 6 characters
- Required fields enforced
- Price/stock must be positive numbers

## Customization Options

### Change Commission Rate:

```sql
UPDATE shop_sellers
SET commission_rate = 20.00  -- Change to 20%
WHERE id = 'seller-uuid';
```

### Auto-Approve Sellers (Development Only):

```sql
ALTER TABLE shop_sellers
ALTER COLUMN is_approved SET DEFAULT true;
```

### Disable Approval Requirement:

Remove approval checks from RLS policies (not recommended for production).

## Troubleshooting

### Seller Can't Login:
- Check email is verified
- Check password is correct
- Verify seller record exists in shop_sellers table

### Products Not Showing:
- Verify `available = true`
- Check seller `is_approved = true`
- Verify seller `is_active = true`

### Earnings Not Calculated:
- Check trigger is enabled
- Verify product has seller_id
- Check order items were created
- View function logs in Supabase

### Dashboard Shows Zero Stats:
- Ensure seller has products
- Check products have orders
- Verify view permissions
- Refresh the page

## File Structure

```
src/
├── app/(subsystems)/shop/
│   └── seller/
│       ├── page.js                    # Login/Signup page
│       └── dashboard/
│           └── page.js                # Seller dashboard
├── components/shop/
│   └── ProductCard.js                 # Updated with seller info
├── contexts/
│   └── SellerAuthContext.js           # Seller authentication
└── lib/
    └── supabaseClient.js              # Database connection

Database:
└── supabase-sellers-schema.sql        # Complete schema
```

## Support & Maintenance

### Regular Tasks:
- Monitor seller applications (approve/reject)
- Review seller earnings for accuracy
- Handle seller support requests
- Update commission rates as needed

### Analytics to Track:
- Number of active sellers
- Total platform revenue
- Commission collected
- Average seller earnings
- Popular sellers by sales

## Future Enhancements

### Potential Features:
- **Seller Performance Analytics**: Detailed charts and graphs
- **Bulk Product Upload**: CSV import for products
- **Seller Ratings**: Customer reviews for sellers
- **Payout System**: Automated seller payouts
- **Seller Tiers**: Different commission rates by performance
- **Promotional Tools**: Seller-created discounts and sales
- **Inventory Alerts**: Low stock notifications
- **Multi-Image Upload**: Product galleries
- **Seller Messaging**: Direct communication with customers

---

## Quick Reference

### Key Files:
- Database Schema: `supabase-sellers-schema.sql`
- Seller Auth: `src/contexts/SellerAuthContext.js`
- Seller Login: `src/app/(subsystems)/shop/seller/page.js`
- Seller Dashboard: `src/app/(subsystems)/shop/seller/dashboard/page.js`
- Product Display: `src/components/shop/ProductCard.js`

### Default Settings:
- Commission Rate: 15%
- Approval Required: Yes
- Default Status: Pending

### Commands:
```bash
# Run development server
npm run dev

# Build for production
npm run build

# Access seller portal
http://localhost:3000/shop/seller

# Access shop (customer view)
http://localhost:3000/shop
```

---

**Last Updated**: Seller system fully integrated with product management, earnings tracking, and customer-facing seller information display.
