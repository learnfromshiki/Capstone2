import { supabase } from './supabaseClient';

/**
 * Resolve which dashboard a signed-in user belongs to.
 * @param {string} userId - Supabase auth user UUID
 * @param {object} [client] - Client used for the lookup; the admin panel passes
 *   its own isolated session so the check is not read with the storefront user.
 * @returns {Promise<'admin'|'seller'|'buyer'>}
 */
export const getAccountRole = async (userId, client = supabase) => {
  try {
    const { data: profile } = await client
      .from('profiles')
      .select('user_type')
      .eq('id', userId)
      .maybeSingle();

    if (profile?.user_type === 'admin') {
      return 'admin';
    }
  } catch (error) {
    console.error('Error reading profile role:', error);
  }

  try {
    const { data: seller } = await client
      .from('shop_sellers')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    if (seller) {
      return 'seller';
    }
  } catch (error) {
    console.error('Error reading seller profile:', error);
  }

  return 'buyer';
};
