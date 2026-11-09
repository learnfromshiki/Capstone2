import { supabase } from './supabaseClient';

/**
 * Upload image to Supabase Storage
 * @param {File} file - Image file to upload
 * @param {string} [userId] - User ID for folder organization (defaults to the signed-in user)
 * @returns {Promise<{url: string, error: null} | {url: null, error: Error}>}
 */
export const uploadProductImage = async (file, userId = 'public') => {
  try {
    // Validate file type
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      throw new Error('Invalid file type. Please upload JPG, PNG, GIF, or WebP images.');
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      throw new Error('File size too large. Maximum size is 5MB.');
    }

    // Storage policies only let a user delete files inside a folder named after
    // their auth uid, so always prefer the signed-in user over a role label.
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId || '');
    let folder = isUuid ? userId : null;
    if (!folder) {
      const { data: authData } = await supabase.auth.getUser();
      folder = authData?.user?.id || userId || 'public';
    }

    // Generate unique filename
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 15);
    const fileExt = file.name.split('.').pop();
    const fileName = `${folder}/${timestamp}-${randomString}.${fileExt}`;

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from('product-images')
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (error) throw error;

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('product-images')
      .getPublicUrl(fileName);

    return { url: publicUrl, error: null };
  } catch (error) {
    console.error('Error uploading image:', error);
    return { url: null, error };
  }
};

/**
 * Delete image from Supabase Storage
 * @param {string} imageUrl - Full URL of the image to delete
 * @returns {Promise<{success: boolean, error: null} | {success: false, error: Error}>}
 */
export const deleteProductImage = async (imageUrl) => {
  try {
    // Extract file path from URL
    const urlParts = imageUrl.split('/product-images/');
    if (urlParts.length < 2) {
      throw new Error('Invalid image URL');
    }
    
    const filePath = urlParts[1];

    // Delete from storage
    const { error } = await supabase.storage
      .from('product-images')
      .remove([filePath]);

    if (error) throw error;

    return { success: true, error: null };
  } catch (error) {
    console.error('Error deleting image:', error);
    return { success: false, error };
  }
};

/**
 * Validate image URL or file
 * @param {string|File} imageInput - URL string or File object
 * @returns {boolean}
 */
export const validateImage = (imageInput) => {
  if (typeof imageInput === 'string') {
    // Validate URL
    try {
      new URL(imageInput);
      return true;
    } catch {
      return false;
    }
  } else if (imageInput instanceof File) {
    // Validate File
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    return validTypes.includes(imageInput.type) && imageInput.size <= 5 * 1024 * 1024;
  }
  return false;
};
