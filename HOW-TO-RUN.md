# How to Run the E-Commerce System

## Quick Start

```bash
npm run dev
```

Then visit:
- **Customer Shop**: http://localhost:3000/shop
- **Admin Panel**: http://localhost:3000/shop/admin (password: `(private: see ADMIN-CREDENTIALS.md)`)

## Features Implemented

### ✅ Customer Shop
- **Authentication Required**: Customers MUST log in before adding products to cart
- **Product Browsing**: View all products with search and category filters
- **Shopping Cart**: Add/remove items, adjust quantities
- **Checkout**: Complete orders with contact info and payment method selection
- **Rewards**: Earn 10 points per ₱100 spent

### ✅ Admin Panel
- **Password Protected**: Password is `(private: see ADMIN-CREDENTIALS.md)`
- **Product Management**: Add, edit, delete products
- **Image Support**: Add product images via URL
- **Dashboard**: View stats (total products, orders, revenue)
- **Order Management**: View all customer orders

## Authentication Flow

### For Customers:
1. Click any "Add to Cart" button → Login modal appears (if not logged in)
2. Sign up with email & password OR log in if you have an account
3. After logging in, you can add products to cart
4. Proceed to checkout when ready

### Rate Limit Issue:
Supabase free tier has email rate limits. If you see "email rate limit exceeded":
- **Wait 5-10 minutes** before trying again
- OR try logging in instead of signing up (if you already created an account)
- OR use a different email address

## Admin Access

Visit: http://localhost:3000/shop/admin
- **Password**: `(private: see ADMIN-CREDENTIALS.md)` (demo credentials are defined in `src/lib/roles.js`)
- Add products with name, price, stock, category, description, artisan name, and image URL
- Products appear instantly in the customer shop

## Database Setup

Make sure you have `.env.local` configured:

```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

Run the SQL schema in Supabase:
```bash
# Use the standalone schema (no profiles dependency)
supabase-shop-schema-standalone.sql
```

## Troubleshooting

### "Email rate limit exceeded"
- **Cause**: Supabase free tier limits signup emails
- **Solution**: Wait 5-10 minutes, or try logging in with existing account

### Can't add to cart
- **Cause**: Not logged in
- **Solution**: System will automatically prompt you to log in when you click "Add to Cart"

### Build errors
```bash
npm run build  # Check for compilation errors
```

### Products not showing
- Check Supabase connection in `.env.local`
- Verify products exist in `shop_products` table with `available = true`

## File Structure

```
src/
├── app/
│   ├── (subsystems)/shop/
│   │   ├── page.js              # Customer shop page
│   │   └── admin/page.js        # Admin panel (password protected)
│   └── layout.js                # Root layout with AuthProvider
├── components/
│   ├── shop/
│   │   ├── Cart.js              # Shopping cart sidebar
│   │   ├── CheckoutModal.js     # Checkout process
│   │   └── ProductCard.js       # Product display card
│   └── AuthModal.js             # Login/signup modal
├── contexts/
│   └── AuthContext.js           # Supabase auth state management
└── lib/
    ├── supabaseClient.js        # Supabase client config
    └── rewards.js               # Points system
```

## Key Changes Made

1. ✅ **Login Required for Cart**: Users must authenticate before adding products
2. ✅ **Better Error Messages**: Rate limit errors show helpful guidance
3. ✅ **Auto Login Prompt**: Clicking "Add to Cart" opens login modal if not authenticated
4. ✅ **Session Persistence**: Users stay logged in across page refreshes

## Next Steps

To enable file uploads for product images:
1. Create Supabase Storage bucket named `product-images`
2. Set bucket to public
3. Update ProductForm to handle file uploads (code ready, just commented out)
