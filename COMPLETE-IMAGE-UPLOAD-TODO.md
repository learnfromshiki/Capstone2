# Complete Image Upload & Categories Feature - Action Items

## ✅ Already Completed

1. ✅ Created `supabase-storage-setup.sql` - Storage bucket configuration
2. ✅ Created `supabase-categories-schema.sql` - Categories table schema
3. ✅ Created `src/lib/imageUpload.js` - Upload utility functions
4. ✅ Updated admin page state variables
5. ✅ Added `handleImageUpload` function
6. ✅ Added `handleAddCategory` function
7. ✅ Added `fetchCategories` function
8. ✅ Updated `fetchData` to include categories tab
9. ✅ Added Categories tab to navigation

## 🔄 Still Need to Complete

### 1. Update Product Form - Category Dropdown

**File:** `src/app/(subsystems)/shop/admin/page.js`

**Find this section** (around line 735):
```javascript
<select
  value={newProduct.category}
  onChange={(e) => setNewProduct({ ...newProduct, category: e.target.value })}
  className="w-full px-4 py-3 border-2 rounded-xl focus:ring-2 focus:ring-blue-500"
  required
>
  <option value="handicrafts">🧺 Handicrafts</option>
  <option value="food">🍽️ Food</option>
  <option value="souvenirs">🎁 Souvenirs</option>
  <option value="weavings">🧵 Weavings</option>
  <option value="art">🎨 Art</option>
</select>
```

**Replace with:**
```javascript
<div className="flex gap-2">
  <select
    value={newProduct.category}
    onChange={(e) => setNewProduct({ ...newProduct, category: e.target.value })}
    className="flex-1 px-4 py-3 border-2 rounded-xl focus:ring-2 focus:ring-blue-500"
    required
  >
    {categories.filter(c => c.slug !== 'all').map((cat) => (
      <option key={cat.id} value={cat.slug}>
        {cat.icon} {cat.name}
      </option>
    ))}
  </select>
  <button
    type="button"
    onClick={() => setShowAddCategory(true)}
    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-colors"
    title="Add New Category"
  >
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  </button>
</div>
```

---

### 2. Add Image Upload Section to Product Form

**File:** `src/app/(subsystems)/shop/admin/page.js`

**After the "Artisan Name" field** (around line 760), add:

```javascript
<div>
  <label className="block text-sm font-semibold mb-2">Product Image</label>
  
  {/* Image Upload */}
  <div className="space-y-4">
    <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center hover:border-blue-500 transition-colors">
      <input
        type="file"
        id="imageUpload"
        accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
        onChange={handleImageUpload}
        className="hidden"
      />
      <label htmlFor="imageUpload" className="cursor-pointer">
        {uploadingImage ? (
          <div className="flex flex-col items-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
            <p className="text-gray-600">Uploading image...</p>
          </div>
        ) : (
          <div>
            <svg className="w-12 h-12 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-gray-600 font-medium mb-2">Click to upload or drag and drop</p>
            <p className="text-sm text-gray-500">JPG, PNG, GIF, WebP (Max 5MB)</p>
          </div>
        )}
      </label>
    </div>

    {/* OR Divider */}
    <div className="relative">
      <div className="absolute inset-0 flex items-center">
        <div className="w-full border-t border-gray-300"></div>
      </div>
      <div className="relative flex justify-center text-sm">
        <span className="px-2 bg-white text-gray-500">OR</span>
      </div>
    </div>

    {/* Image URL Input */}
    <input
      type="url"
      value={newProduct.image_url}
      onChange={(e) => setNewProduct({ ...newProduct, image_url: e.target.value })}
      placeholder="https://example.com/image.jpg"
      className="w-full px-4 py-3 border-2 rounded-xl focus:ring-2 focus:ring-blue-500"
    />

    {/* Image Preview */}
    {(imagePreview || newProduct.image_url) && (
      <div className="mt-4">
        <p className="text-sm font-semibold mb-2">Preview:</p>
        <img
          src={imagePreview || newProduct.image_url}
          alt="Preview"
          className="w-full h-48 object-cover rounded-lg"
          onError={(e) => {
            e.target.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><text x="50%" y="50%" text-anchor="middle" dy=".3em" fill="%23999">Invalid Image</text></svg>';
          }}
        />
      </div>
    )}
  </div>
</div>
```

---

### 3. Add Categories Tab Content

**File:** `src/app/(subsystems)/shop/admin/page.js`

**After the Orders tab content** (around line 660), add before the closing tag:

```javascript
) : activeTab === 'categories' ? (
  <div>
    <div className="flex justify-between items-center mb-6">
      <h3 className="text-xl font-bold">Manage Categories</h3>
      <button
        onClick={() => setShowAddCategory(true)}
        className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-2.5 rounded-lg font-semibold hover:from-blue-700 hover:to-indigo-700 transition-all shadow-md hover:shadow-lg"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        Add Category
      </button>
    </div>

    <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
      <table className="w-full">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase">Icon</th>
            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase">Name</th>
            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase">Slug</th>
            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase">Description</th>
            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase">Order</th>
            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {categories.map((category) => (
            <tr key={category.id} className="hover:bg-gray-50">
              <td className="px-6 py-4 text-2xl">{category.icon}</td>
              <td className="px-6 py-4 font-semibold">{category.name}</td>
              <td className="px-6 py-4 text-sm text-gray-600">{category.slug}</td>
              <td className="px-6 py-4 text-sm text-gray-600">{category.description || '-'}</td>
              <td className="px-6 py-4 text-sm">{category.display_order}</td>
              <td className="px-6 py-4">
                <span className={`px-3 py-1 text-xs font-semibold rounded-full ${
                  category.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                }`}>
                  {category.is_active ? 'Active' : 'Inactive'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
```

---

### 4. Add Category Modal

**File:** `src/app/(subsystems)/shop/admin/page.js`

**After the Add Product Modal** (at the end before closing div), add:

```javascript
{/* Add Category Modal */}
{showAddCategory && (
  <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
    <div className="bg-white rounded-2xl max-w-md w-full">
      <div className="p-6 border-b">
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-bold">Add New Category</h2>
          <button onClick={() => setShowAddCategory(false)} className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <form onSubmit={handleAddCategory} className="p-6 space-y-4">
        <div>
          <label className="block text-sm font-semibold mb-2">Category Name *</label>
          <input
            type="text"
            value={newCategory.name}
            onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })}
            className="w-full px-4 py-3 border-2 rounded-xl focus:ring-2 focus:ring-blue-500"
            placeholder="e.g., Electronics"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-semibold mb-2">Icon (Emoji) *</label>
          <input
            type="text"
            value={newCategory.icon}
            onChange={(e) => setNewCategory({ ...newCategory, icon: e.target.value })}
            className="w-full px-4 py-3 border-2 rounded-xl focus:ring-2 focus:ring-blue-500 text-2xl"
            placeholder="📦"
            required
            maxLength={2}
          />
          <p className="text-xs text-gray-500 mt-1">Choose any emoji (🎯 📱 👕 🍕 etc.)</p>
        </div>

        <div>
          <label className="block text-sm font-semibold mb-2">Description</label>
          <textarea
            value={newCategory.description}
            onChange={(e) => setNewCategory({ ...newCategory, description: e.target.value })}
            rows="3"
            className="w-full px-4 py-3 border-2 rounded-xl focus:ring-2 focus:ring-blue-500"
            placeholder="Optional category description"
          />
        </div>

        <div className="flex gap-3 pt-4">
          <button
            type="button"
            onClick={() => setShowAddCategory(false)}
            className="flex-1 px-6 py-3 border-2 rounded-xl font-semibold hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex-1 px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl font-semibold hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50"
          >
            {loading ? 'Adding...' : 'Add Category'}
          </button>
        </div>
      </form>
    </div>
  </div>
)}
```

---

## 🗄️ Database Setup

Run these in Supabase SQL Editor:

```sql
-- 1. Create categories table
\i supabase-categories-schema.sql

-- 2. Set up storage bucket
\i supabase-storage-setup.sql
```

---

## 🧪 Testing Steps

1. **Test Category Creation:**
   - Go to Categories tab
   - Click "Add Category"
   - Create "Electronics" with 📱 icon
   - Verify appears in table
   - Verify appears in product form dropdown

2. **Test Image Upload:**
   - Click "Add Product"
   - Click "Click to upload"
   - Select an image
   - Verify upload progress shows
   - Verify preview appears
   - Submit product
   - Verify image shows in product list

3. **Test URL Method:**
   - Add product with URL instead
   - Verify still works
   - Verify preview shows

---

## 📝 Summary

**Total Changes Needed:** 4 sections to add/update in admin page  
**Time Estimate:** 15-20 minutes  
**Difficulty:** Easy (copy-paste)  

**Status:** 70% Complete - Just need UI updates  
**Next:** Apply the 4 code sections above to complete

