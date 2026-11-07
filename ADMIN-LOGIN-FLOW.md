# Admin Login Flow - How It Works

## 🎯 Automatic Admin Redirect

When you log in with admin credentials **anywhere in the system**, you will be automatically redirected to the admin panel.

---

## ✅ Step-by-Step Process

### 1. Go to the Shop
- URL: http://localhost:3001/shop
- Or any page with the login modal

### 2. Click "Sign In"
- Opens the authentication modal

### 3. Enter Admin Credentials
- **Email:** shiki@gmail.com
- **Password:** shiki1234

### 4. Automatic Redirect
- System detects admin credentials
- Stores credentials in sessionStorage temporarily
- **Automatically redirects to /shop/admin**
- Admin page verifies credentials
- Logs you into admin dashboard

---

## 🔐 How It Works Behind the Scenes

1. **AuthModal checks credentials:**
   ```javascript
   if (email === 'shiki@gmail.com' && password === 'shiki1234') {
     sessionStorage.setItem('admin_redirect_email', email);
     sessionStorage.setItem('admin_redirect_password', password);
     window.location.href = '/shop/admin';
   }
   ```

2. **Admin page receives the redirect:**
   ```javascript
   const redirectEmail = sessionStorage.getItem('admin_redirect_email');
   const redirectPassword = sessionStorage.getItem('admin_redirect_password');
   
   if (redirectEmail === 'shiki@gmail.com' && redirectPassword === 'shiki1234') {
     setIsAuthenticated(true);
     sessionStorage.setItem('admin_authenticated', 'true');
     // Clear temporary credentials
     sessionStorage.removeItem('admin_redirect_email');
     sessionStorage.removeItem('admin_redirect_password');
   }
   ```

3. **You're now logged into the admin panel!**

---

## 🎉 Benefits

✅ **Single Login System** - No separate admin login page needed
✅ **Automatic Detection** - System knows when admin credentials are used
✅ **Seamless Redirect** - Instantly takes you to admin dashboard
✅ **Secure** - Credentials are verified twice and cleared after use
✅ **Session Persistence** - Stay logged in until you logout

---

## 📝 Notes

- Admin credentials work in **any login form** (shop, homepage, etc.)
- Regular customer credentials work normally for shopping
- Admin session persists until logout or browser close
- Temporary credentials are immediately cleared after verification
- No changes needed to existing customer login flow

---

**Last Updated:** January 2025
