import { supabase } from './supabaseClient';

/** Longest side, in pixels, of a photo after it is shrunk for upload. */
const MAX_DIMENSION = 1600;
/** Photos already this small are sent as they are. */
const SMALL_ENOUGH = 600 * 1024;
/** A resized PNG bigger than this is sent as a JPEG instead. */
const LARGE_PNG = 1.5 * 1024 * 1024;

/**
 * Shrink a phone photo before it is uploaded. A 4-8 MB camera picture often
 * failed on a slow or unsteady connection ("Failed to fetch": the upload was
 * cut off), and nothing on the site shows an image larger than 1600px anyway.
 * GIFs (possibly animated) and anything the browser cannot draw are sent as
 * they are.
 */
export const shrinkImage = async (file) => {
  if (typeof window === 'undefined' || !file?.type?.startsWith('image/')) return file;
  if (file.type === 'image/gif' || file.size <= SMALL_ENOUGH) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const encode = (type) => new Promise((resolve) => canvas.toBlob(resolve, type, 0.85));

    // PNG keeps its transparency (logos); everything else becomes a JPEG.
    // A PNG photo can stay several MB even after resizing, so a PNG that is
    // still large is sent as a JPEG instead (photos have no transparency).
    let type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    let blob = await encode(type);
    if (type === 'image/png' && (!blob || blob.size > LARGE_PNG)) {
      type = 'image/jpeg';
      blob = await encode(type);
    }
    if (!blob || blob.size >= file.size) return file;

    const name = file.name.replace(/\.[^.]+$/, '') + (type === 'image/png' ? '.png' : '.jpg');
    return new File([blob], name, { type, lastModified: Date.now() });
  } catch (error) {
    console.warn('Could not shrink the image, uploading it as it is:', error);
    return file;
  }
};

const isNetworkError = (error) =>
  error?.name === 'TypeError' ||
  /failed to fetch|network|load failed|fetch failed/i.test(error?.message || '');

// When the first try's connection dropped after the file had arrived, the
// retry is told the file already exists: that means it did upload.
const isAlreadyThere = (error) => /already exists|duplicate/i.test(error?.message || '') || error?.statusCode === '409';

/**
 * Upload to a storage bucket, trying once more if the connection drops, and
 * turning a dropped connection into a message a shop owner can act on.
 */
export const uploadWithRetry = async (bucket, path, file, options) => {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const { error } = await supabase.storage.from(bucket).upload(path, file, options);
      if (!error) return;
      if (attempt === 2 && isAlreadyThere(error)) return;
      if (attempt === 2 || !isNetworkError(error)) throw error;
    } catch (error) {
      if (attempt === 2 || !isNetworkError(error)) {
        if (isNetworkError(error)) {
          throw new Error('The upload was cut off. Please check your internet connection and try again.');
        }
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
};

/**
 * Upload image to Supabase Storage
 * @param {File} file - Image file to upload
 * @param {string} [userId] - User ID for folder organization (defaults to the signed-in user)
 * @returns {Promise<{url: string, error: null} | {url: null, error: Error}>}
 */
export const uploadProductImage = async (originalFile, userId = 'public') => {
  try {
    // Shrink first, so the size limit below applies to what is actually sent.
    const file = await shrinkImage(originalFile);

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
    await uploadWithRetry('product-images', fileName, file, {
      cacheControl: '3600',
      upsert: false,
    });

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

/**
 * Upload a profile picture. Everyone (customer, seller, admin) writes into a
 * folder named after their own user id, which is what the storage policy in
 * supabase-product-options.sql checks.
 *
 * @param {File} file
 * @returns {Promise<{url: string, error: null} | {url: null, error: Error}>}
 */
export const uploadProfileImage = async (originalFile) => {
  try {
    const file = await shrinkImage(originalFile);

    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      throw new Error('Please choose a JPG, PNG, GIF or WebP image.');
    }

    // Phone cameras produce 4-8MB photos, so 2MB turned away most of what
    // people actually tried to upload.
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      throw new Error('That picture is too large. Please choose one under 10MB.');
    }

    const { data: authData } = await supabase.auth.getUser();
    const userId = authData?.user?.id;
    if (!userId) throw new Error('Please sign in again before changing your picture.');

    const fileExt = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const fileName = `${userId}/${Date.now()}.${fileExt}`;

    try {
      await uploadWithRetry('profile-images', fileName, file, { cacheControl: '3600', upsert: true });
    } catch (error) {
      if (/bucket.*not found/i.test(error.message || '')) {
        throw new Error('Profile pictures are not set up yet. Run supabase-product-options.sql in Supabase.');
      }
      throw error;
    }

    const { data: { publicUrl } } = supabase.storage.from('profile-images').getPublicUrl(fileName);

    return { url: publicUrl, error: null };
  } catch (error) {
    console.error('Error uploading the profile picture:', error);
    return { url: null, error };
  }
};
