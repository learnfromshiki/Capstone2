import { supabase } from './supabaseClient';
import { fetchProfileRow } from './profile';

/**
 * Where each role belongs after signing in.
 */
export const DASHBOARD_PATHS = {
  admin: '/shop/admin',
  seller: '/shop/seller/dashboard',
  customer: '/shop/buyer',
};

export const ROLE_LABELS = {
  admin: 'Admin',
  seller: 'Seller',
  customer: 'Customer',
};

/**
 * Owning a row in shop_sellers is what makes an account a seller - not
 * profiles.user_type.
 *
 * Why: profiles.user_type cannot be changed from the browser. The database
 * trigger protect_profile_privileged_fields() pins it on every update by a
 * non-admin, and it does that silently (no error), so older "promote this
 * profile to seller" code looked like it worked while the column stayed
 * 'tourist'. Any screen that read profiles.user_type therefore treated the
 * shop owner as a customer. Reading shop_sellers instead cannot drift: a
 * seller always owns that row, and RLS lets them read their own copy whether
 * or not the shop is approved yet.
 *
 * supabase-auth-roles-fix.sql repairs the stored user_type as well, so the
 * admin Customers/Sellers lists are right, but the app no longer depends on it.
 */
export const resolveAccount = async (user, client = supabase) => {
  const empty = { role: 'customer', seller: null, profile: null, isSuspended: false };
  if (!user?.id) return empty;

  let profile = null;
  let seller = null;

  try {
    profile = await fetchProfileRow(user.id, client);
  } catch (error) {
    console.warn('Profile lookup failed:', error?.message || error);
  }

  // Admin wins over everything else, so an admin who also owns a shop still
  // lands in the admin panel.
  if (profile?.user_type === 'admin') {
    return { role: 'admin', seller: null, profile, isSuspended: Boolean(profile?.is_suspended) };
  }

  try {
    const { data, error } = await client
      .from('shop_sellers')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.warn('Could not read the shop profile:', error.message);
    }
    seller = data || null;
  } catch (error) {
    console.warn('Shop lookup failed:', error?.message || error);
  }

  if (seller) {
    return { role: 'seller', seller, profile, isSuspended: Boolean(profile?.is_suspended) };
  }

  // Registered as a seller but the shop row has not been written yet (the
  // signup happened while email confirmation was still pending). Still a
  // seller - never route this account into the customer dashboard.
  if (user.user_metadata?.account_type === 'seller') {
    return { role: 'seller', seller: null, profile, isSuspended: Boolean(profile?.is_suspended) };
  }

  return { role: 'customer', seller: null, profile, isSuspended: Boolean(profile?.is_suspended) };
};

/**
 * @param {string} userId - Supabase auth user UUID
 * @param {object} [client] - Client used for the lookup; the admin panel passes
 *   its own isolated session so the check is not read with the storefront user.
 * @returns {Promise<'admin'|'seller'|'customer'>}
 */
export const getAccountRole = async (userId, client = supabase) => {
  if (!userId) return 'customer';

  // Callers that only have an id still get the metadata fallback, because the
  // signed-in user is the one being looked up almost every time.
  let user = { id: userId };
  try {
    const { data } = await client.auth.getUser();
    if (data?.user?.id === userId) user = data.user;
  } catch (error) {
    console.warn('Could not read the signed-in user:', error?.message || error);
  }

  const { role } = await resolveAccount(user, client);
  return role;
};

/** Where to send this account after a successful sign-in. */
export const dashboardPathForRole = (role) => DASHBOARD_PATHS[role] || DASHBOARD_PATHS.customer;
