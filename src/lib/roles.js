import { supabase } from './supabaseClient';

// Demo admin account kept for the class demo (no Supabase account required)
export const DEMO_ADMIN_EMAIL = 'shiki@gmail.com';
export const DEMO_ADMIN_PASSWORD = 'shiki1234';

/**
 * Resolve which dashboard a signed-in user belongs to.
 * @param {string} userId - Supabase auth user UUID
 * @returns {Promise<'admin'|'seller'|'buyer'>}
 */
export const getAccountRole = async (userId) => {
  try {
    const { data: profile } = await supabase
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
    const { data: seller } = await supabase
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
