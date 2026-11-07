# Sign Up Feature - Customer & Seller Registration

## 🎯 New Feature Overview

Users can now choose to sign up as either a **Customer** or **Seller** during registration.

---

## 👥 Two Account Types

### 🛍️ Customer Account
- **Purpose:** Shop and buy products
- **Access:** Immediate access after email confirmation
- **Features:**
  - Browse and purchase products
  - View order history
  - Earn rewards points
  - Track deliveries

### 🏪 Seller Account
- **Purpose:** Sell products on the platform
- **Access:** Requires admin approval before selling
- **Features:**
  - Access to seller dashboard
  - Add and manage products
  - Track sales and earnings
  - View customer orders
  - Manage inventory

---

## 📝 Sign Up Process

### For Customers:
1. Click "Sign In" → "Don't have an account? Sign up"
2. Select **"Customer"** account type
3. Fill in:
   - Full Name
   - Email
   - Password (min 6 characters)
4. Click "Create Account"
5. Check email for confirmation
6. Start shopping!

### For Sellers:
1. Click "Sign In" → "Don't have an account? Sign up"
2. Select **"Seller"** account type
3. Fill in:
   - Contact Name *
   - Business Name *
   - Email *
   - Password (min 6 characters) *
   - Contact Phone (optional)
   - Business Address (optional)
4. Click "Create Account"
5. **Wait for admin approval** ⏳
6. Receive notification when approved
7. Access seller dashboard

---

## 🔐 Admin Approval for Sellers

Seller accounts must be approved by an admin before they can:
- Access the seller dashboard
- Add products to the marketplace
- Start selling

### Admin Approval Process:
1. Seller signs up
2. Seller record created with `is_approved: false`
3. Admin reviews seller application
4. Admin approves or rejects
5. Seller receives notification
6. Approved sellers can access `/shop/seller`

---

## 🎨 UI Features

### Account Type Selector
- Visual cards with icons
- Clear distinction between Customer 🛍️ and Seller 🏪
- Blue highlight for selected type
- Interactive hover effects

### Dynamic Form
- Form fields change based on account type
- Required fields marked with *
- Seller-specific fields only show for sellers
- Warning message about admin approval for sellers

### Validation
- Email format validation
- Password minimum 6 characters
- Required fields enforced
- Business name required for sellers

---

## 🗄️ Database Structure

### Customer Data (Supabase Auth)
```sql
auth.users {
  id: UUID
  email: string
  user_metadata: {
    full_name: string
  }
}
```

### Seller Data (shop_sellers table)
```sql
shop_sellers {
  id: UUID
  user_id: UUID (references auth.users)
  business_name: string
  contact_email: string
  contact_phone: string (nullable)
  address: string (nullable)
  is_approved: boolean (default: false)
  is_active: boolean (default: true)
  commission_rate: decimal (default: 15.00)
  created_at: timestamp
}
```

---

## ✅ Success Messages

### Customer Registration:
> "Check your email to confirm your account!"

### Seller Registration:
> "✅ Seller account created! Awaiting admin approval. Check your email to confirm."

---

## 🚀 Testing the Feature

### Test Customer Sign Up:
1. Go to http://localhost:3001/shop
2. Click "Sign In"
3. Click "Don't have an account? Sign up"
4. Select "Customer"
5. Fill form and submit
6. Check console/email

### Test Seller Sign Up:
1. Go to http://localhost:3001/shop
2. Click "Sign In"
3. Click "Don't have an account? Sign up"
4. Select "Seller"
5. Fill all seller fields
6. Submit and note approval message
7. Account created but needs admin approval

---

## 🔧 Technical Implementation

### Files Modified:
- `src/components/AuthModal.js` - Added account type selection and seller fields
- Database: Uses existing `shop_sellers` table from schema

### Key Functions:
```javascript
// Account type state
const [accountType, setAccountType] = useState('customer');

// Seller-specific fields
const [businessName, setBusinessName] = useState('');
const [contactPhone, setContactPhone] = useState('');
const [address, setAddress] = useState('');

// Create seller record after signup
if (accountType === 'seller' && data?.user) {
  await supabase.from('shop_sellers').insert([{
    user_id: data.user.id,
    business_name: businessName,
    contact_email: email,
    is_approved: false
  }]);
}
```

---

## 📋 Next Steps for Admins

To approve sellers, admins should:
1. Log in to admin panel
2. Add a "Sellers" tab to view pending approvals
3. Review seller information
4. Update `is_approved: true` for approved sellers
5. Notify sellers via email

---

**Last Updated:** January 2025
