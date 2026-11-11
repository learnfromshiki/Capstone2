import { supabase } from './supabaseClient';

/**
 * One notification inbox shared by customers, sellers and the admin.
 *
 * Nothing is written from the browser: every row is created by a database
 * trigger when an order, message, review or shop decision happens, so the
 * three dashboards all see the same truth (supabase-notifications-payments.sql).
 */

const MISSING = /shop_notifications/i;

/** True when the migration has not been run yet, so the bell stays quiet. */
export const isMissingNotifications = (error) =>
  error?.code === '42P01' || error?.code === 'PGRST205' || MISSING.test(error?.message || '');

const COLUMNS = 'id, audience, kind, title, body, link, created_at, read_at';

/**
 * The newest notifications for the signed-in person.
 * @param {'customer'|'seller'|'admin'} [audience] - leave out for every audience
 * @param {number} [limit]
 */
export const listNotifications = async (audience, limit = 20) => {
  try {
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData?.user?.id;
    if (!userId) return [];

    let query = supabase
      .from('shop_notifications')
      .select(COLUMNS)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (audience) query = query.eq('audience', audience);

    const { data, error } = await query;
    if (error) {
      if (!isMissingNotifications(error)) console.warn('Notifications unavailable:', error.message);
      return [];
    }

    return data || [];
  } catch (error) {
    return [];
  }
};

/** How many are still unread, for the badge on the bell. */
export const countUnreadNotifications = async (audience) => {
  try {
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData?.user?.id;
    if (!userId) return 0;

    let query = supabase
      .from('shop_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('read_at', null);

    if (audience) query = query.eq('audience', audience);

    const { count, error } = await query;
    if (error) return 0;
    return count || 0;
  } catch (error) {
    return 0;
  }
};

/** Mark one notification as read (when the person taps it). */
export const markNotificationRead = async (id) => {
  if (!id) return;
  try {
    await supabase
      .from('shop_notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', id)
      .is('read_at', null);
  } catch (error) {
    console.warn('Could not mark the notification as read:', error?.message || error);
  }
};

/** Mark everything in this inbox as read. */
export const markAllNotificationsRead = async (audience) => {
  try {
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData?.user?.id;
    if (!userId) return;

    let query = supabase
      .from('shop_notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('read_at', null);

    if (audience) query = query.eq('audience', audience);

    await query;
  } catch (error) {
    console.warn('Could not clear the notifications:', error?.message || error);
  }
};

/** How long ago, in words, for the dropdown. */
export const timeAgo = (value) => {
  if (!value) return '';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '';

  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;

  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;

  return new Date(value).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
};

/** The small picture that goes with each kind of notification. */
export const ICONS = {
  message: '💬',
  order: '🧾',
  review: '⭐',
  shop: '🏪',
  account: '🔔',
};
