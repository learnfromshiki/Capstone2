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

/**
 * profiles.user_type is what the admin Customers list and the dashboards read, so a
 * shop owner must be recorded as a seller there as well. Otherwise the same account
 * shows up as a buyer in Customers and gets buyer routing on sign-in. Admins are
 * never downgraded.
 */
const markProfileAsSeller = async (userId) => {
  if (!userId) return;

  try {
    const { data: profile, error: readError } = await supabase
      .from('profiles')
      .select('user_type')
      .eq('id', userId)
      .maybeSingle();

    if (readError && readError.code !== 'PGRST116') {
      console.warn('Could not read the profile role:', readError.message);
      return;
    }

    if (!profile || profile.user_type === 'seller' || profile.user_type === 'admin') {
      return;
    }

    const { error } = await supabase
      .from('profiles')
      .update({ user_type: 'seller' })
      .eq('id', userId);

    if (error) {
      console.warn('Could not flag the profile as a seller:', error.message);
    }
  } catch (error) {
    console.warn('Seller role promotion failed:', error);
  }
};

/**
 * True when the account itself was created through a seller registration. Those
 * accounts are sellers from the start and must never be treated as buyers, even
 * before an admin approves the shop.
 * @param {object} user - Supabase auth user
 * @returns {boolean}
 */
export const isSellerRegistration = (user) => Boolean(readSellerIntent(user));

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
      await markProfileAsSeller(user.id);
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

    await markProfileAsSeller(user.id);

    return created;
  } catch (error) {
    console.error('Seller profile check failed:', error);
    return null;
  }
};
