# Image Upload & Dynamic Categories - Implementation Guide

## 🎯 Features Added

### 1. Image Upload to Supabase Storage
✅ Upload product images directly from admin panel  
✅ Images stored in Supabase Storage bucket  
✅ Automatic file validation (type, size)  
✅ Image preview before saving  
✅ Support for both upload and URL input  

### 2. Dynamic Categories
✅ Create custom product categories  
✅ Categories stored in database  
✅ Icon and description support  
✅ Display order management  
✅ Active/inactive status  

---

## 📁 Files Created

1. **`supabase-storage-setup.sql`** - Storage bucket setup
2. **`supabase-categories-schema.sql`** - Categories table
3. **`src/lib/imageUpload.js`** - Image upload utilities
4. **`IMAGE-UPLOAD-FEATURE.md`** (this file) - Documentation

---

## 🗄️ Database Setup Required

Run these SQL files in Supabase SQL Editor in order:

### Step 1: Create Categories Table
```bash
supabase-categories-schema.sql
```

### Step 2: Set Up Storage Bucket
```bash
supabase-storage-setup.sql
```

---

## 🔧 How to Use

### Upload Image (Admin Panel)
1. Click "Add Product"
2. See new "Upload Image" section
3. Click "Click to upload" or drag & drop
4. Image uploads automatically
5. Preview shows immediately
6. OR paste URL in text field (still works)

### Create Category (Admin Panel)
1. Go to "Categories" tab
2. Click "Add Category"
3. Fill: Name, Icon (emoji), Description
4. Submit
5. New category appears in product form dropdown

---

## 🖼️ Image Upload Features

### Supported Formats
- JPG/JPEG
- PNG
- GIF
- WebP

### File Size Limit
- Maximum: 5MB per image

### Storage Structure
```
product-images/
  ├── admin/
  │   ├── timestamp-random.jpg
  │   └── timestamp-random.png
  └── seller_id/
      └── timestamp-random.jpg
```

### URL Format
```
https://[project].supabase.co/storage/v1/object/public/product-images/admin/1234567890-abc123.jpg
```

---

## 📋 Category Features

### Default Categories
- 🏪 All Products
- 🧺 Handicrafts
- 🍽️ Food
- 🎁 Souvenirs
- 🧵 Weavings
- 🎨 Art

### Custom Categories
- Any name you want
- Choose any emoji icon
- Add description
- Set display order
- Toggle active/inactive

---

## 🔐 Security & Permissions

### Storage Policies
```sql
-- Anyone can view (public bucket)
SELECT: public

-- Only authenticated can upload
INSERT: authenticated users only

-- Only owner can update/delete
UPDATE/DELETE: file owner only
```

### Category Policies
```sql
-- Anyone can view active categories
SELECT: is_active = true

-- Authenticated can manage
INSERT/UPDATE: authenticated users
```

---

## 🎨 UI Updates

### Product Form Now Has:
```
[Product Name]
[Description]
[Price] [Stock]
[Category] <- Dynamic dropdown from database
[Artisan Name]

📷 Image Upload Section:
  ┌─────────────────────────┐
  │   Click to upload or    │
  │   drag & drop image     │
  │   JPG, PNG, GIF, WebP   │
  │   Max 5MB               │
  └─────────────────────────┘
  
  OR
  
  [Image URL: https://...]
  
  [Image Preview]
  
[Cancel] [Add Product]
```

### New Categories Tab:
```
┌─ Products ─┬─ Categories ─┬─ Orders ─┐
             │                          │
             │ [+ Add Category]         │
             │                          │
             │ 📦 All Products          │
             │ 🧺 Handicrafts           │
             │ 🍽️ Food                  │
             │ ...                      │
             └──────────────────────────┘
```

---

## 💻 Code Examples

### Upload Image (JavaScript)
```javascript
import { uploadProductImage } from '@/lib/imageUpload';

const handleImageUpload = async (e) => {
  const file = e.target.files[0];
  const { url, error } = await uploadProductImage(file, 'admin');
  
  if (error) {
    alert('Upload failed: ' + error.message);
  } else {
    console.log('Image URL:', url);
    // Use the URL in your product
  }
};
```

### Create Category (JavaScript)
```javascript
const { error } = await supabase
  .from('shop_categories')
  .insert([{
    name: 'New Category',
    slug: 'new-category',
    icon: '🎯',
    description: 'Category description'
  }]);
```

### Fetch Categories
```javascript
const { data, error } = await supabase
  .from('shop_categories')
  .select('*')
  .eq('is_active', true)
  .order('display_order');
```

---

## 🧪 Testing Checklist

### Image Upload
- [ ] Upload JPG image (< 5MB)
- [ ] Upload PNG image (< 5MB)
- [ ] Try uploading > 5MB (should fail)
- [ ] Try uploading .txt file (should fail)
- [ ] Verify image appears in Supabase Storage
- [ ] Verify image URL works in product
- [ ] Delete product and verify image cleanup

### Categories
- [ ] Create new category
- [ ] Verify appears in dropdown
- [ ] Verify shows in shop page filters
- [ ] Edit category name
- [ ] Toggle category active/inactive
- [ ] Verify display order works

### Integration
- [ ] Create product with uploaded image
- [ ] Create product with URL image
- [ ] Create product with new category
- [ ] Verify product displays correctly in shop
- [ ] Verify category filter works

---

## 🐛 Troubleshooting

### "Upload failed: Invalid file type"
→ Only JPG, PNG, GIF, WebP allowed

### "Upload failed: File size too large"
→ Maximum 5MB per image

### "Storage bucket not found"
→ Run `supabase-storage-setup.sql`

### "Categories table doesn't exist"
→ Run `supabase-categories-schema.sql`

### "Image not showing"
→ Check Storage policies in Supabase dashboard

### "Can't create category"
→ Check you're authenticated as admin

---

## 🚀 Next Steps

### Phase 1 (Completed)
- ✅ Image upload utility created
- ✅ Storage bucket configured
- ✅ Categories table created
- ✅ Admin UI updated (partially)

### Phase 2 (In Progress)
- ⏳ Update product form UI
- ⏳ Add category management tab
- ⏳ Test all functionalities

### Phase 3 (Future)
- ⬜ Image optimization/compression
- ⬜ Multiple images per product
- ⬜ Image cropping tool
- ⬜ Bulk image upload
- ⬜ Category icons library

---

## 📖 API Reference

### `uploadProductImage(file, userId)`
Uploads an image to Supabase Storage

**Parameters:**
- `file` (File): Image file object
- `userId` (string): User ID for folder organization

**Returns:**
```javascript
{ url: string, error: null } // Success
{ url: null, error: Error }  // Failure
```

### `deleteProductImage(imageUrl)`
Deletes an image from Supabase Storage

**Parameters:**
- `imageUrl` (string): Full URL of image to delete

**Returns:**
```javascript
{ success: true, error: null }  // Success
{ success: false, error: Error } // Failure
```

### `validateImage(imageInput)`
Validates image URL or file

**Parameters:**
- `imageInput` (string|File): URL or File object

**Returns:**
- `boolean`: true if valid, false otherwise

---

## 🎉 Benefits

### For Admins
- ✅ No need for external image hosting
- ✅ Faster product creation
- ✅ Better organization
- ✅ Automatic validation

### For Users
- ✅ Faster image loading
- ✅ Consistent image quality
- ✅ Better mobile experience

### For System
- ✅ Better security
- ✅ Centralized storage
- ✅ Easier backups
- ✅ Cost tracking

---

**Status:** ⚠️ Partially Implemented - Admin UI updates in progress  
**Next:** Complete admin panel UI updates  
**Priority:** High

