'use client';

import { supabase } from './supabaseClient';

/**
 * Shopee-style storefront helpers: "X sold", followers, vouchers, sale
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
// Shop vouchers
// ---------------------------------------------------------------------------

const isLive = (voucher, now = Date.now()) =>
  voucher.is_active &&
  (!voucher.starts_at || new Date(voucher.starts_at).getTime() <= now) &&
  (!voucher.ends_at || new Date(voucher.ends_at).getTime() > now) &&
  (!voucher.usage_limit || Number(voucher.used_count) < Number(voucher.usage_limit));

/** Live vouchers of the given shops: { [sellerId]: voucher[] } */
export const fetchShopVouchers = async (sellerIds = null) => {
  let query = supabase
    .from('shop_vouchers')
    .select('id, seller_id, code, kind, amount, min_spend, max_discount, starts_at, ends_at, usage_limit, used_count, is_active')
    .eq('is_active', true)
    .order('min_spend', { ascending: true });
  if (Array.isArray(sellerIds)) {
    if (sellerIds.length === 0) return {};
    query = query.in('seller_id', sellerIds);
  }
  const { data, error } = await query;
  if (error) {
    if (!isMissing(error)) console.warn('Vouchers unavailable:', error.message);
    return {};
  }
  return (data || []).filter((voucher) => isLive(voucher)).reduce((groups, voucher) => {
    (groups[voucher.seller_id] = groups[voucher.seller_id] || []).push(voucher);
    return groups;
  }, {});
};

const peso = (value) => `₱${Number(value).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`;

/** "₱50 off" / "10% off (up to ₱100)" and the minimum spend line. */
export const describeVoucher = (voucher) => {
  const headline =
    voucher.kind === 'percent'
      ? `${Number(voucher.amount)}% off${voucher.max_discount ? ` (up to ${peso(voucher.max_discount)})` : ''}`
      : `${peso(voucher.amount)} off`;
  const minimum = Number(voucher.min_spend) > 0 ? `Min. spend ${peso(voucher.min_spend)}` : 'No minimum spend';
  const until = voucher.ends_at
    ? `Valid until ${new Date(voucher.ends_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}`
    : '';
  return { headline, minimum, until };
};

/**
 * What a voucher takes off a shop's subtotal, by the same rule place_order()
 * applies. Returns { discount } or { error }.
 */
export const voucherDiscount = (voucher, subtotal) => {
  if (!voucher || !isLive(voucher)) return { error: 'This voucher is no longer available.' };
  const amount = Number(subtotal) || 0;
  if (amount < Number(voucher.min_spend || 0)) {
    return { error: `Spend at least ${peso(voucher.min_spend)} at this shop to use ${voucher.code}.` };
  }
  let discount =
    voucher.kind === 'percent'
      ? Math.round(amount * Number(voucher.amount)) / 100
      : Number(voucher.amount);
  if (voucher.max_discount) discount = Math.min(discount, Number(voucher.max_discount));
  return { discount: Math.min(discount, amount) };
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
