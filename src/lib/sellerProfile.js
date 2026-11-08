import { supabase } from './supabaseClient';

/**
 * Seller signups made while email confirmation is pending have no session, so the
 * shop_sellers row cannot be written then. Everything that signs a user in calls
 * this so the shop profile is created on the first successful sign-in instead.
 */
const readSellerIntent = (user) => {
  const metadata = user?.user_metadata || {};

  if (metadata.account_type !== 'seller' || !metadata.business_name) {
    return null;
  }

  return {
    business_name: metadata.business_name,
    contact_phone: metadata.contact_phone || null,
    address: metadata.address || null,
  };
};

// Keep profiles.user_type in step with the seller table so the admin Customers
// list never shows a seller (it treats every non-seller profile as a customer).
const promoteProfileRole = async (userId) => {
  const { error } = await supabase
    .from('profiles')
    .update({ user_type: 'seller' })
    .eq('id', userId);

  if (error) {
    console.warn('Could not mark the profile as a seller:', error.message);
  }
};

/**
 * @param {object} user - Supabase auth user (needs id, email, user_metadata)
 * @returns {Promise<object|null>} the seller row, or null when this user is a buyer
 */
export const ensureSellerProfile = async (user) => {
  if (!user?.id) return null;

  try {
    const { data: existing, error: readError } = await supabase
      .from('shop_sellers')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (readError && readError.code !== 'PGRST116') {
      console.error('Could not read the seller profile:', readError.message);
      return null;
    }

    if (existing) {
      // Repair accounts whose seller row exists but whose profile says otherwise
      await promoteProfileRole(user.id);
      return existing;
    }

    const intent = readSellerIntent(user);
    if (!intent) return null;

    const { data: created, error: createError } = await supabase
      .from('shop_sellers')
      .insert({
        user_id: user.id,
        business_name: intent.business_name,
        contact_email: user.email,
        contact_phone: intent.contact_phone,
        address: intent.address,
        is_approved: false,
        is_active: true,
      })
      .select()
      .maybeSingle();

    if (createError) {
      console.error('Could not create the seller profile:', createError.message);
      return null;
    }

    await promoteProfileRole(user.id);
    return created;
  } catch (error) {
    console.error('Seller profile check failed:', error);
    return null;
  }
};
