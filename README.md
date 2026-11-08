# CONNECT-Daet E-commerce Platform 🛍️

Modern **multi-seller marketplace** for authentic Daet products - supporting local artisans and preserving Bicol cultural heritage.

## 🌟 What's New: Multi-Seller System!

This platform now supports **multiple sellers** who can independently manage their products and track their earnings!

### Three User Types:
- 👥 **Customers** - Browse and shop
- 🏪 **Sellers** - Manage products and track earnings
- 👨‍💼 **Admin** - Oversee the entire platform

## ✨ Features

### For Customers:
- 🛒 **Product Catalog** - Browse local handicrafts, food, souvenirs, weavings, and art
- 🏪 **Seller Information** - See which seller offers each product
- 🎨 **Professional UI** - Modern design with smooth animations
- 📱 **Mobile Responsive** - Optimized for all devices
- 🛍️ **Shopping Cart** - Real-time cart with smart checkout (login required)
- 🔐 **Authentication** - Secure signup and login
- 🎁 **Rewards System** - 10 points per ₱100 spent
- 🔍 **Smart Search** - Search by product, seller, artisan, or category

### For Sellers:
- 📦 **Product Management** - Add, edit, delete your own products
- 💰 **Earnings Dashboard** - Track sales and commissions in real-time
- 📊 **Statistics** - View products, orders, revenue, and earnings
- 💳 **Commission Tracking** - Transparent 15% platform fee
- 🎯 **Business Profile** - Manage your business information
- ✅ **Approval Workflow** - Admin approval before you can sell

### For Admin:
- 👨‍💼 **Admin Dashboard** - Manage all products and orders
- 📈 **Platform Statistics** - Overview of entire marketplace
- 👥 **Seller Management** - Approve new sellers
- 🔒 **Password Protected** - Secure admin access

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Setup Environment
Create `.env.local` file:
```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
```

### 3. Setup Database
```bash
# Open Supabase SQL Editor and run:
1. supabase-shop-schema-standalone.sql  # Core e-commerce
2. supabase-sellers-schema.sql          # Seller system
```
This creates all tables, triggers, and sample data.

### 4. Start Development
```bash
npm run dev
```

### 5. Access the System
- **Shop**: http://localhost:3000/shop
- **Seller Portal**: http://localhost:3000/shop/seller
- **Admin Panel**: http://localhost:3000/shop/admin (password: `shiki1234`)

## 📁 Structure

```
src/
├── app/
│   ├── page.js                         # Landing page
│   ├── layout.js                       # Root with auth providers
│   └── (subsystems)/shop/
│       ├── page.js                     # Customer shop
│       ├── admin/page.js               # Admin dashboard
│       └── seller/
│           ├── page.js                 # Seller login/signup
│           └── dashboard/page.js       # Seller dashboard
├── components/shop/
│   ├── ProductCard.js                  # Product display (with seller info)
│   ├── Cart.js                         # Shopping cart
│   ├── CheckoutModal.js                # Checkout flow
│   └── AuthModal.js                    # Customer auth modal
├── contexts/
│   ├── AuthContext.js                  # Customer authentication
│   └── SellerAuthContext.js            # Seller authentication
└── lib/
    ├── supabaseClient.js               # Database client
    └── rewards.js                      # Points system
```

## 🎯 Main Routes

| Route | Description | Access |
|-------|-------------|--------|
| `/` | Landing page | Public |
| `/shop` | Customer shop | Public (cart requires login) |
| `/shop/seller` | Seller login/signup | Public |
| `/shop/seller/dashboard` | Seller dashboard | Sellers only |
| `/shop/admin` | Admin panel | Password: `shiki1234` |

## 🏪 User Journeys

### Customer Flow:
1. Browse products at `/shop`
2. See seller information on each product
3. Click "Add to Cart" → Login if not authenticated
4. Review cart and proceed to checkout
5. Complete order and earn reward points

### Seller Flow:
1. Register at `/shop/seller`
2. Fill business information and submit
3. Wait for admin approval
4. Login and access dashboard
5. Add products with pricing and details
6. Track earnings as orders come in

### Admin Flow:
1. Login at `/shop/admin` with password
2. View platform statistics
3. Manage all products from any seller
4. Approve new sellers (via SQL currently)
5. Monitor orders and revenue

## 💰 Commission System

- **Platform Fee**: 15% (configurable per seller)
- **Seller Earns**: 85% of each sale
- **Automatic Calculation**: Earnings calculated via database trigger
- **Status Tracking**: pending → paid → cancelled

**Example:**
```
Sale Price: ₱1,000
Platform Fee (15%): ₱150
Seller Earns (85%): ₱850
```

## 🎨 Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Styling**: Tailwind CSS
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth
- **Language**: JavaScript/React
- **State Management**: React Context API

## 📊 Database Tables

### Core E-Commerce:
- `shop_products` - Product listings (with seller_id)
- `shop_orders` - Customer orders
- `shop_order_items` - Order line items

### Seller System:
- `shop_sellers` - Seller profiles and business info
- `shop_seller_earnings` - Commission and earnings tracking
- `seller_dashboard_stats` - Aggregated seller statistics (view)

### Authentication:
- `auth.users` - User accounts (Supabase Auth)

## 🔧 Commands

```bash
npm run dev      # Start development server
npm run build    # Build for production
npm run start    # Run production build
npm run lint     # Check code quality
```

## 💳 Payment Options

- GCash
- Cash on Delivery (COD)
- Bank Transfer

## 🏪 Product Categories

- 🧺 Handicrafts
- 🍽️ Food
- 🎁 Souvenirs
- 🧵 Weavings
- 🎨 Art

## 📱 Responsive Design

- Mobile: 375px+
- Tablet: 768px+
- Desktop: 1024px+

## 🎁 Rewards

Earn 10 points for every ₱100 spent. Points automatically added to user profile.

## 🔐 Security Features

- **Authentication**: Email verification required
- **Authorization**: Row Level Security (RLS) policies
- **Data Isolation**: Sellers see only their own data
- **Password Protection**: Admin panel secured
- **Session Management**: Secure token-based sessions

## 🛠️ Admin Tasks

### Approve a Seller:
```sql
UPDATE shop_sellers 
SET is_approved = true 
WHERE contact_email = 'seller@example.com';
```

### Adjust Commission Rate:
```sql
UPDATE shop_sellers 
SET commission_rate = 20.00 
WHERE id = 'seller-uuid';
```

### View Pending Sellers:
```sql
SELECT * FROM shop_sellers 
WHERE is_approved = false;
```

## 📚 Documentation

- **Quick Reference**: `QUICK-REFERENCE.md`
- **Complete Overview**: `COMPLETE-SYSTEM-OVERVIEW.md`
- **Seller Guide**: `SELLER-SYSTEM-GUIDE.md`
- **Setup Instructions**: `HOW-TO-RUN.md`
- **Rate Limit Fix**: `RATE-LIMIT-FIX.md`

## 🚢 Deployment

### Vercel (Recommended)
1. Push to GitHub
2. Connect to Vercel
3. Add environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Deploy!

### Database (Supabase)
1. Create Supabase project
2. Run SQL schema files in SQL Editor
3. Copy URL and anon key to `.env.local`

## 🧪 Testing

```bash
# Build to check for errors
npm run build

# Test customer flow
# → Go to /shop
# → Try adding to cart (should prompt login)
# → Complete checkout

# Test seller flow
# → Register at /shop/seller
# → Add products in dashboard
# → View earnings

# Test admin flow
# → Login at /shop/admin
# → Manage products
```

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| Rate limit error | Wait 5-10 min or disable email confirmation (dev only) |
| Products not showing | Check: available=true, seller is_approved=true |
| Can't login | Verify email confirmed, check correct credentials |
| Earnings not calculated | Verify trigger enabled and product has seller_id |

## 🔮 Future Enhancements

- [ ] Seller approval UI (currently via SQL)
- [ ] Automated payout system
- [ ] Seller ratings and reviews
- [ ] Advanced analytics with charts
- [ ] Bulk product upload (CSV)
- [ ] Product image galleries
- [ ] Customer-seller messaging
- [ ] Mobile app (React Native)

## 📝 License

Part of CONNECT-Daet.ph Tourism Ecosystem

## 🤝 Contributing

This is a capstone project for educational purposes. For contributions or questions, please contact the development team.

---

**Built with ❤️ for Daet, Camarines Norte**

**Version**: 1.0.0  
**Status**: ✅ Production Ready  
**Features**: Multi-Seller Marketplace, Customer Authentication, Admin Controls, Automated Earnings
