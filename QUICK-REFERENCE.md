# ⚡ Quick Reference Card

## 🚀 Start System
```bash
npm run dev
```

## 🔗 Access URLs
| User Type | URL | Credentials |
|-----------|-----|-------------|
| **Customer** | http://localhost:3000/shop | Create account or login |
| **Seller** | http://localhost:3000/shop/seller | Create seller account |
| **Admin** | http://localhost:3000/shop/admin | Password: `(private: see ADMIN-CREDENTIALS.md)` |

## 📊 User Capabilities

### 👥 Customers
- ✅ Browse & search products
- ✅ Add to cart (login required)
- ✅ Checkout & place orders
- ✅ Earn reward points

### 🏪 Sellers
- ✅ Register business
- ✅ Add/edit/delete products
- ✅ Track earnings (85% after 15% commission)
- ✅ View sales statistics
- ⚠️ Requires admin approval

### 👨‍💼 Admin
- ✅ View all products & orders
- ✅ Manage any product
- ✅ Platform statistics
- ⚠️ Approve sellers manually

## 💾 Database Setup
```sql
-- Run this file in Supabase SQL Editor
supabase-sellers-schema.sql
```

## 🔑 Quick Commands

### Approve Seller
```sql
UPDATE shop_sellers 
SET is_approved = true 
WHERE contact_email = 'seller@example.com';
```

### Change Commission Rate
```sql
UPDATE shop_sellers 
SET commission_rate = 20.00 
WHERE id = 'seller-uuid';
```

### View Pending Sellers
```sql
SELECT * FROM shop_sellers 
WHERE is_approved = false;
```

## 💰 Commission Calculation
```
Sale: ₱1,000
Platform Fee (15%): ₱150
Seller Earns (85%): ₱850
```

## 🛠️ Troubleshooting

| Issue | Solution |
|-------|----------|
| Rate limit error | Wait 5-10 min or disable email confirmation |
| Products not showing | Check: available=true, is_approved=true |
| Can't login | Verify email, check seller record exists |
| Earnings not calculated | Check trigger enabled, product has seller_id |

## 📁 Key Files
```
supabase-sellers-schema.sql          # Database
src/contexts/SellerAuthContext.js    # Seller auth
src/app/(subsystems)/shop/seller/    # Seller pages
src/app/(subsystems)/shop/page.js    # Customer shop
src/app/(subsystems)/shop/admin/     # Admin panel
```

## 🔐 Security Features
- ✅ Email verification required
- ✅ Password hashing (Supabase)
- ✅ Row Level Security (RLS)
- ✅ Data isolation per user
- ✅ Admin password protection

## 📚 Full Documentation
- **Complete Guide**: `SELLER-SYSTEM-GUIDE.md`
- **Overview**: `COMPLETE-SYSTEM-OVERVIEW.md`
- **Summary**: `SELLER-SYSTEM-SUMMARY.md`
- **Setup**: `HOW-TO-RUN.md`

## ✅ System Status
🟢 All features operational  
🟢 Build successful  
🟢 Security implemented  
🟢 Documentation complete  

**Version**: 1.0.0  
**Status**: Production Ready
