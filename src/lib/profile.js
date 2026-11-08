import { supabase } from './supabaseClient';

/**
 * A login can exist in auth without a profiles row (the row was deleted while the
 * account stayed). The buyer dashboard reads that row for the display name, points
 * and suspension, and the admin Customers list is built from it, so restore it on
 * sign-in. This runs with the user's own session, which is what the insert policy
 * checks (auth.uid() = id).
 */
export const ensureProfileRow = async (user) => {
  if (!user?.id) return null;

  try {
    const { data: existing } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();

    if (existing) return existing;

    const metadata = user.user_metadata || {};

    const { data: created, error } = await supabase
      .from('profiles')
      .insert({
        id: user.id,
        email: user.email,
        full_name: metadata.full_name || (user.email || '').split('@')[0] || 'Customer',
        user_type: metadata.account_type === 'seller' ? 'seller' : 'tourist',
        points: 0,
      })
      .select()
      .maybeSingle();

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
