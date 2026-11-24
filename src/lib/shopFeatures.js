'use client';

import { supabase } from './supabaseClient';

/**
 * Shopee-style storefront helpers: "X sold", followers, sale
 * prices, recently viewed and sharing. The database parts are in
 * supabase-shopee-features.sql; every function here fails soft, so a page
 * still works when that file has not been run.
 */

const isMissing = (error) =>
  /function .* does not exist|could not find the function|relation .* does not exist|schema cache/i.test(
    error?.message || ''
  );

/** { [productId]: units sold } over every order that was not cancelled. */
export const fetchSoldCounts = async () => {
  const { data, error } = await supabase.rpc('product_sold_counts');
  if (error) {
    if (!isMissing(error)) console.warn('Sold counts unavailable:', error.message);
    return {};
  }
  return Object.fromEntries((data || []).map((row) => [row.product_id, Number(row.sold) || 0]));
};

/** 1234 -> "1.2k" the way marketplaces print it. */
export const formatSold = (count) => {
  const n = Number(count) || 0;
  if (n >= 10000) return `${Math.floor(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
};

// ---------------------------------------------------------------------------
// Following shops
// ---------------------------------------------------------------------------

/** { [sellerId]: followers } */
export const fetchFollowerCounts = async () => {
  const { data, error } = await supabase.rpc('shop_follower_counts');
  if (error) {
    if (!isMissing(error)) console.warn('Follower counts unavailable:', error.message);
    return {};
  }
  return Object.fromEntries((data || []).map((row) => [row.seller_id, Number(row.followers) || 0]));
};

/** The shops this account follows, as a Set of seller ids. */
export const fetchMyFollows = async (userId) => {
  if (!userId) return new Set();
  const { data, error } = await supabase.from('shop_follows').select('seller_id').eq('user_id', userId);
  if (error) {
    if (!isMissing(error)) console.warn('Followed shops unavailable:', error.message);
    return new Set();
  }
  return new Set((data || []).map((row) => row.seller_id));
};

export const setFollowing = async (userId, sellerId, follow) => {
  const query = follow
    ? supabase.from('shop_follows').insert({ user_id: userId, seller_id: sellerId })
    : supabase.from('shop_follows').delete().eq('user_id', userId).eq('seller_id', sellerId);
  const { error } = await query;
  // Following twice is still following.
  if (error && !(follow && /duplicate key/i.test(error.message || ''))) throw error;
};

// ---------------------------------------------------------------------------
// Sale prices
// ---------------------------------------------------------------------------

/** The "was" price and the % off, or null when the product is not on sale. */
export const saleInfo = (product) => {
  const price = Number(product?.price) || 0;
  const original = Number(product?.original_price) || 0;
  if (!price || original <= price) return null;
  return { original, percent: Math.round((1 - price / original) * 100) };
};

// ---------------------------------------------------------------------------
// Recently viewed (this browser only)
// ---------------------------------------------------------------------------

const RECENT_KEY = 'recently_viewed_products';
const RECENT_MAX = 12;

export const readRecentlyViewed = () => {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch (error) {
    return [];
  }
};

export const rememberViewed = (productId) => {
  if (!productId || typeof window === 'undefined') return [];
  const ids = [productId, ...readRecentlyViewed().filter((id) => id !== productId)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids));
  } catch (error) {
    // Private mode: the list simply is not remembered.
  }
  return ids;
};

export const clearRecentlyViewed = () => {
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch (error) {
    // nothing to clear
  }
};

// ---------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------

/** Share a product link (phone share sheet, else copy). Returns 'shared' | 'copied' | 'failed'. */
export const shareProduct = async (product) => {
  if (typeof window === 'undefined' || !product?.id) return 'failed';
  // The product's own page: link previews show its photo, name and price.
  const url = `${window.location.origin}/shop/product/${product.id}`;
  const title = product.name || 'CONNECT-Daet';

  if (navigator.share) {
    try {
      await navigator.share({ title, text: `${title} on CONNECT-Daet`, url });
      return 'shared';
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled';
    }
  }

  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch (error) {
    return 'failed';
  }
};
