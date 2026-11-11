'use client';

/**
 * The customer's saved items.
 *
 * Kept in this browser rather than the database, so it works for a shopper who
 * has not finished signing up, and shared by the storefront and the dashboard
 * through one key per account. Both listen for `wishlist-changed`, so hearting
 * a product on the shop page updates the Wishlist tab immediately.
 */

export const WISHLIST_EVENT = 'wishlist-changed';

export const wishlistKey = (userId) => `wishlist:${userId}`;

export const readWishlist = (userId) => {
  if (!userId || typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(wishlistKey(userId));
    const parsed = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('Could not read your wishlist:', error);
    return [];
  }
};

export const writeWishlist = (userId, ids) => {
  if (!userId || typeof window === 'undefined') return;
  try {
    localStorage.setItem(wishlistKey(userId), JSON.stringify(ids));
    window.dispatchEvent(new CustomEvent(WISHLIST_EVENT, { detail: { userId, ids } }));
  } catch (error) {
    console.warn('Could not save your wishlist:', error);
  }
};

/**
 * Add or remove one product.
 * @returns {{ ids: string[], saved: boolean }} the new list, and whether the
 *          product is now saved
 */
export const toggleWishlist = (userId, productId) => {
  const current = readWishlist(userId);
  const saved = !current.includes(productId);
  const ids = saved ? [...current, productId] : current.filter((id) => id !== productId);

  writeWishlist(userId, ids);
  return { ids, saved };
};

export const isWishlisted = (ids, productId) => (ids || []).includes(productId);
