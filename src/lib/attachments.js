import { supabase } from './supabaseClient';

/**
 * Photos and short videos people attach: to a message, to a review, to a
 * payment receipt, or the QR code a shop shows for GCash and bank transfers.
 *
 * Everything goes into the public `shop-uploads` bucket, inside a folder named
 * after the uploader's user id, which is what the storage policy in
 * supabase-notifications-payments.sql allows.
 */

const BUCKET = 'shop-uploads';

export const IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
export const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];

const IMAGE_LIMIT = 5 * 1024 * 1024; // 5 MB
const VIDEO_LIMIT = 25 * 1024 * 1024; // 25 MB

const BUCKET_MISSING =
  'Uploads are not set up yet. Ask the admin to run supabase-notifications-payments.sql in Supabase.';

/** 'image', 'video' or null for anything we do not accept. */
export const kindOf = (file) => {
  if (!file?.type) return null;
  if (IMAGE_TYPES.includes(file.type)) return 'image';
  if (VIDEO_TYPES.includes(file.type)) return 'video';
  return null;
};

/**
 * Upload one file.
 * @param {File} file
 * @param {string} folder - a short label kept inside your own folder, e.g. 'chat'
 * @param {{ allowVideo?: boolean }} [options]
 * @returns {Promise<{url: string, type: 'image'|'video'}>}
 */
export const uploadAttachment = async (file, folder = 'misc', { allowVideo = true } = {}) => {
  const type = kindOf(file);

  if (!type) {
    throw new Error(
      allowVideo
        ? 'Please choose a JPG, PNG, GIF or WebP photo, or an MP4, WebM or MOV video.'
        : 'Please choose a JPG, PNG, GIF or WebP photo.'
    );
  }

  if (type === 'video' && !allowVideo) {
    throw new Error('Only photos can be attached here.');
  }

  const limit = type === 'video' ? VIDEO_LIMIT : IMAGE_LIMIT;
  if (file.size > limit) {
    throw new Error(
      type === 'video'
        ? 'That video is too large. Please keep it under 25MB.'
        : 'That photo is too large. Please keep it under 5MB.'
    );
  }

  const { data: authData } = await supabase.auth.getUser();
  const userId = authData?.user?.id;
  if (!userId) throw new Error('Please sign in again before uploading.');

  const safeFolder = (folder || 'misc').replace(/[^a-z0-9-]/gi, '').slice(0, 20) || 'misc';
  const extension = (file.name.split('.').pop() || (type === 'video' ? 'mp4' : 'jpg')).toLowerCase();
  const path = `${userId}/${safeFolder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false });

  if (error) {
    if (/bucket.*not found/i.test(error.message || '')) throw new Error(BUCKET_MISSING);
    throw new Error(error.message || 'Could not upload that file.');
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(BUCKET).getPublicUrl(path);

  return { url: publicUrl, type };
};

/** Upload several photos at once, for a review. */
export const uploadPhotos = async (files, folder = 'review', max = 5) => {
  const chosen = Array.from(files || []).slice(0, max);
  const urls = [];

  for (const file of chosen) {
    const { url } = await uploadAttachment(file, folder, { allowVideo: false });
    urls.push(url);
  }

  return urls;
};

/** True when a stored URL points at a video rather than a photo. */
export const looksLikeVideo = (url) => /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url || '');
