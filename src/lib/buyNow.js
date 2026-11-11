import { cartLineId } from './productOptions';

/**
 * "Buy Now" buys one item straight away, without touching the cart.
 *
 * The chosen line is parked in sessionStorage for the checkout page to pick
 * up: sessionStorage because it belongs to this one purchase attempt and
 * should not outlive the tab or mix with the saved cart.
 */
const keyFor = (userId) => `shop_buynow:${userId}`;

export const storeBuyNow = (userId, product, quantity = 1, selectedOptions = {}) => {
  if (typeof window === 'undefined' || !userId) return null;

  const line = {
    ...product,
    productId: product.id,
    lineId: cartLineId(product.id, selectedOptions),
    selectedOptions,
    quantity: Math.max(1, Number(quantity) || 1),
  };

  try {
    window.sessionStorage.setItem(keyFor(userId), JSON.stringify(line));
  } catch (error) {
    console.error('Could not start the purchase:', error);
    return null;
  }

  return line;
};

export const readBuyNow = (userId) => {
  if (typeof window === 'undefined' || !userId) return null;

  try {
    const stored = window.sessionStorage.getItem(keyFor(userId));
    return stored ? JSON.parse(stored) : null;
  } catch (error) {
    console.error('Could not read the purchase:', error);
    return null;
  }
};

export const clearBuyNow = (userId) => {
  if (typeof window === 'undefined' || !userId) return;

  try {
    window.sessionStorage.removeItem(keyFor(userId));
  } catch (error) {
    console.error('Could not clear the purchase:', error);
  }
};
