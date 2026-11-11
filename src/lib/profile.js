import { supabase } from './supabaseClient';

const BASE_PROFILE_COLUMNS = 'id, full_name, email, user_type, is_suspended, points, avatar_url';
const EXTENDED_PROFILE_COLUMNS = `${BASE_PROFILE_COLUMNS}, first_name, last_name`;

/** Postgres "column does not exist" / PostgREST "unknown column". */
const isMissingColumn = (error) =>
  error?.code === '42703' ||
  error?.code === 'PGRST204' ||
  /column .* does not exist|could not find the .* column/i.test(error?.message || '');

/**
 * Read a profile row, tolerating a database where supabase-auth-roles-fix.sql
 * has not been run yet (no first_name / last_name columns). Without this
 * fallback the whole sign-in would fail on an older database, because a select
 * naming a missing column returns an error and no row at all.
 */
export const fetchProfileRow = async (userId, client = supabase) => {
  if (!userId) return null;

  const read = async (columns) =>
    client.from('profiles').select(columns).eq('id', userId).maybeSingle();

  let { data, error } = await read(EXTENDED_PROFILE_COLUMNS);

  if (error && isMissingColumn(error)) {
    ({ data, error } = await read(BASE_PROFILE_COLUMNS));
  }

  if (error && error.code !== 'PGRST116') {
    console.warn('Could not read the profile:', error.message);
    return null;
  }

  return data || null;
};

/** "Juan" + "Dela Cruz" -> "Juan Dela Cruz"; keeps full_name working everywhere. */
export const joinName = (firstName, lastName) =>
  [firstName, lastName].map((part) => (part || '').trim()).filter(Boolean).join(' ');

/** Best-effort split of an existing full_name into first and last. */
export const splitName = (fullName) => {
  const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
};

/**
 * A login can exist in auth without a profiles row (the row was deleted while the
 * account stayed). The customer dashboard reads that row for the display name,
 * points and suspension, and the admin Customers list is built from it, so
 * restore it on sign-in. This runs with the user's own session, which is what
 * the insert policy checks (auth.uid() = id).
 */
export const ensureProfileRow = async (user) => {
  if (!user?.id) return null;

  try {
    const metadata = user.user_metadata || {};
    const isSellerAccount = metadata.account_type === 'seller';

    const existing = await fetchProfileRow(user.id);
    if (existing) return existing;

    const fallbackName = (user.email || '').split('@')[0] || 'Customer';
    const firstName = metadata.first_name || '';
    const lastName = metadata.last_name || '';
    const fullName = metadata.full_name || joinName(firstName, lastName) || fallbackName;

    const row = {
      id: user.id,
      email: user.email,
      full_name: fullName,
      // 'tourist' is the stored value for a customer across this database; the
      // insert policy only accepts 'tourist' or 'seller'. The UI label is
      // "Customer" (see ROLE_LABELS in lib/roles.js).
      user_type: isSellerAccount ? 'seller' : 'tourist',
      points: 0,
    };

    let { data: created, error } = await supabase
      .from('profiles')
      .insert({ ...row, first_name: firstName || null, last_name: lastName || null })
      .select()
      .maybeSingle();

    // Older database without the name columns: insert the base row instead.
    if (error && isMissingColumn(error)) {
      ({ data: created, error } = await supabase.from('profiles').insert(row).select().maybeSingle());
    }

    if (error) {
      console.warn('Could not restore the profile row:', error.message);
      return null;
    }

    return created;
  } catch (error) {
    console.warn('Profile check failed:', error);
    return null;
  }
};

/**
 * Keep profiles.user_type in step with the account's real role.
 *
 * This is best-effort on purpose. The database trigger
 * protect_profile_privileged_fields() silently pins user_type for non-admins,
 * so before supabase-auth-roles-fix.sql is run this update changes nothing and
 * reports no error. Nothing in the app depends on it: roles are resolved from
 * shop_sellers (see lib/roles.js). It only keeps the admin lists tidy.
 */
export const syncProfileRole = async (userId, role) => {
  if (!userId || !['seller', 'tourist'].includes(role)) return;

  try {
    const existing = await fetchProfileRow(userId);
    if (!existing || existing.user_type === role || existing.user_type === 'admin') return;

    const { error } = await supabase.from('profiles').update({ user_type: role }).eq('id', userId);
    if (error) console.warn('Could not update the stored account type:', error.message);
  } catch (error) {
    console.warn('Account type sync failed:', error?.message || error);
  }
};
