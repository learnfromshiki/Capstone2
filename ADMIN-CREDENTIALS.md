# Admin Credentials

## Admin Panel Access

There are **TWO WAYS** to access the admin panel:

### Method 1: Direct URL Access (Original)
**URL:** http://localhost:3001/shop/admin (or http://localhost:3000/shop/admin)

**Login Credentials:**
- **Email:** shiki@gmail.com
- **Password:** shiki1234

### Method 2: Through Shop Login (New - Automatic Redirect)
1. Go to the shop: http://localhost:3001/shop
2. Click **"Sign In"** button
3. Enter admin credentials:
   - **Email:** shiki@gmail.com
   - **Password:** shiki1234
4. **Automatically redirects to admin panel** ✨

---

## Important Notes

- The admin panel is protected with email and password authentication
- Session is stored in browser's sessionStorage
- You will remain logged in until you logout or close the browser
- The credentials are hardcoded in the application for security
- **NEW:** Admin credentials entered in the shop login will automatically redirect to the admin panel instead of regular shop access

## What You Can Do in Admin Panel

✅ View dashboard statistics (products, orders, revenue)
✅ Add new products with images
✅ Search and filter products
✅ Activate/Deactivate products
✅ Delete products
✅ View all orders
✅ Update order status
✅ View customer information

---

**Last Updated:** January 2025
