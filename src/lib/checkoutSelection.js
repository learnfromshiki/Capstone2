'use client';

/**
 * Which cart lines are going through checkout.
 *
 * The cart is a shopping list: a customer ticks the two things they want now
 * and leaves the rest for later, the way Shopee and Lazada work. The ticks are
 * made in the cart and read again on the checkout page, so they travel in this
 * browser's session storage rather than through the URL, where a long list of
 * line ids would be unreadable and easy to tamper with.
 *
 * Nothing here is trusted by the database: place_order() prices and checks
 * every line again on the server.
 */

const key = (userId) => `shop_checkout_selection:${userId}`;

export const storeSelection = (userId, lineIds) => {
  if (!userId || typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(key(userId), JSON.stringify(lineIds || []));
  } catch (error) {
    console.warn('Could not remember which items you selected:', error);
  }
};

/** The chosen line ids, or null when nothing was chosen (check out everything). */
export const readSelection = (userId) => {
  if (!userId || typeof window === 'undefined') return null;
  try {
    const stored = sessionStorage.getItem(key(userId));
    if (!stored) return null;

    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    return null;
  }
};

export const clearSelection = (userId) => {
  if (!userId || typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(key(userId));
  } catch (error) {
    // Nothing to do: a stale selection is filtered against the live cart anyway
  }
};
