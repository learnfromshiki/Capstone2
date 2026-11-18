import { supabase } from './supabaseClient';

// Same test as isMissingFunction() in orders.js, kept here so the two modules
// do not import each other.
const isMissingFunction = (error) =>
  error?.code === 'PGRST202' ||
  error?.code === '42883' ||
  /could not find the function|function .* does not exist/i.test(error?.message || '');

/**
 * The numbers on every sidebar, tab and header badge.
 *
 * nav_badge_counts() (supabase-live-badges-reset.sql) works them all out in
 * one call, for the signed-in person only:
 *   admin    - pending_sellers, orders_to_handle, orders_pending, out_of_stock,
 *              suspended_customers, notifications
 *   seller   - orders_new, orders_to_ship, messages, out_of_stock, new_reviews,
 *              notifications
 *   customer - messages, order_updates, orders_to_receive, to_review,
 *              notifications
 *
 * Returns null when the function is not installed yet, so each page can fall
 * back to the counts it already had.
 */
let functionMissing = false;

export const fetchBadgeCounts = async (audience) => {
  if (functionMissing || !supabase) return null;

  try {
    const { data, error } = await supabase.rpc('nav_badge_counts', { p_audience: audience });
    if (error) {
      if (isMissingFunction(error)) functionMissing = true;
      else console.warn('Could not load the badge counts:', error.message);
      return null;
    }
    return data && typeof data === 'object' ? data : {};
  } catch (error) {
    return null;
  }
};

/**
 * Something this page did changed a count (a chat was read, an order moved
 * on, a notification was opened). Every badge on the page reloads at once
 * instead of waiting for the next poll.
 */
export const BADGE_REFRESH_EVENT = 'connect-daet:badges';

export const requestBadgeRefresh = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(BADGE_REFRESH_EVENT));
};

/**
 * The database reported a change (Realtime). Anything that lists
 * notifications, like the bell, reloads too.
 */
export const BADGE_CHANGED_EVENT = 'connect-daet:badges-changed';
