import { supabase } from './supabaseClient';
import { cartLineId } from './productOptions';
import { isMissingFunction } from './orders';

/**
 * The shopping cart, saved in the database (shop_cart_items).
 *
 * The database is the source of truth, so a cart follows the customer to any
 * device or browser. A copy is kept in localStorage under the customer's own
 * key so the cart shows instantly while the database answers, and so the shop
 * keeps working on a database that has not run
 * supabase-cart-pickup-redemption.sql yet.
 *
 * Prices stored with a line are only for display: place_order() always
 * re-prices every line on the server.
 */

const localKey = (userId) => `shop_cart:${userId}`;
// Set once this browser's cart has been copied into the database, so an old
// local copy never resurrects a cart the customer emptied on another device.
const syncedKey = (userId) => `shop_cart_synced:${userId}`;

/** Give every line the fields the cart code relies on. */
export const normalizeCart = (lines) =>
  (Array.isArray(lines) ? lines : [])
    .filter((item) => item && (item.productId || item.id))
    .map((item) => ({
      ...item,
      productId: item.productId || item.id,
      selectedOptions: item.selectedOptions || {},
      lineId: item.lineId || cartLineId(item.productId || item.id, item.selectedOptions),
    }));

/** The copy in this browser. Instant, but may be stale. */
export const readLocalCart = (userId) => {
  if (!userId) return [];
  try {
    const stored = localStorage.getItem(localKey(userId));
    return normalizeCart(stored ? JSON.parse(stored) : []);
  } catch (error) {
    console.error('Error reading the cart:', error);
    return [];
  }
};

const writeLocalCart = (userId, lines) => {
  if (!userId) return;
  try {
    if (lines.length > 0) localStorage.setItem(localKey(userId), JSON.stringify(lines));
    else localStorage.removeItem(localKey(userId));
  } catch (error) {
    console.error('Error saving the cart:', error);
  }
};

const markSynced = (userId) => {
  try {
    localStorage.setItem(syncedKey(userId), '1');
  } catch {
    // Private mode: the cart still saves, it just may re-sync once.
  }
};

const isSynced = (userId) => {
  try {
    return localStorage.getItem(syncedKey(userId)) === '1';
  } catch {
    return false;
  }
};

/** True when the shop_cart_items table / save_my_cart() are not installed. */
const isMissingCartTable = (error) =>
  isMissingFunction(error) ||
  error?.code === '42P01' ||
  error?.code === 'PGRST205' ||
  /shop_cart_items/i.test(error?.message || '');

// ---------------------------------------------------------------------------
// Saving: the latest cart for each customer is sent once the customer pauses,
// so tapping "+" five times is one request, not five.
// ---------------------------------------------------------------------------
const pending = new Map(); // userId -> { timer, lines }
let databaseAvailable = true;

const toRow = (item) => {
  // Everything the storefront shows for the line, without the bulky or
  // derived fields.
  const { quantity, selectedOptions, lineId, productId, ...rest } = item;
  return {
    line_id: String(lineId).slice(0, 300),
    product_id: productId,
    quantity: Math.max(1, Math.min(9999, Math.floor(Number(quantity) || 1))),
    options: selectedOptions && Object.keys(selectedOptions).length > 0 ? selectedOptions : {},
    item: { ...rest, id: productId },
  };
};

const pushToDatabase = async (userId, lines) => {
  if (!databaseAvailable || !supabase) return;

  const { error } = await supabase.rpc('save_my_cart', { p_items: lines.map(toRow) });

  if (error) {
    if (isMissingCartTable(error)) {
      databaseAvailable = false;
      return;
    }
    console.error('Your cart could not be saved online:', error.message);
    return;
  }

  markSynced(userId);
};

/** Send any cart change that is still waiting. Call before leaving the page. */
export const flushCart = async (userId) => {
  const entry = pending.get(userId);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(userId);
  await pushToDatabase(userId, entry.lines);
};

/**
 * Save the cart: at once in this browser, and in the database shortly after.
 */
export const saveCart = (userId, lines, { immediate = false } = {}) => {
  if (!userId) return Promise.resolve();
  const normalized = normalizeCart(lines);
  writeLocalCart(userId, normalized);

  const existing = pending.get(userId);
  if (existing) clearTimeout(existing.timer);

  if (immediate) {
    pending.delete(userId);
    return pushToDatabase(userId, normalized);
  }

  const timer = setTimeout(() => {
    pending.delete(userId);
    pushToDatabase(userId, normalized);
  }, 400);
  pending.set(userId, { timer, lines: normalized });
  return Promise.resolve();
};

/**
 * The customer's cart from the database.
 *
 * - Database has lines: they win, and refresh the local copy.
 * - Database is empty but this browser still has a cart that was never
 *   synced (it was made before carts were saved online): upload it once.
 * - Database not set up yet: the local copy.
 */
export const loadCart = async (userId) => {
  if (!userId) return [];
  const local = readLocalCart(userId);

  if (!databaseAvailable || !supabase) return local;

  // A change made a moment ago may still be waiting to be sent.
  if (pending.has(userId)) return pending.get(userId).lines;

  const { data, error } = await supabase
    .from('shop_cart_items')
    .select('line_id, product_id, quantity, options, item, position')
    .eq('user_id', userId)
    .order('position', { ascending: true });

  if (error) {
    if (isMissingCartTable(error)) {
      databaseAvailable = false;
    } else {
      console.error('Could not load your saved cart:', error.message);
    }
    return local;
  }

  if ((data || []).length === 0) {
    if (local.length > 0 && !isSynced(userId)) {
      await pushToDatabase(userId, local);
      return local;
    }
    markSynced(userId);
    writeLocalCart(userId, []);
    return [];
  }

  const lines = normalizeCart(
    data.map((row) => ({
      ...(row.item || {}),
      id: row.product_id,
      productId: row.product_id,
      lineId: row.line_id,
      quantity: row.quantity,
      selectedOptions: row.options || {},
    }))
  );

  markSynced(userId);
  writeLocalCart(userId, lines);
  return lines;
};
