import { supabase } from './supabaseClient';

/**
 * The names of several shops at once, for checkout's per-shop groups:
 * { [sellerId]: { id, business_name } }. Returns {} on failure, so checkout
 * falls back to the name saved on the cart line.
 */
export const fetchShopNames = async (sellerIds) => {
  const ids = Array.from(new Set((sellerIds || []).filter(Boolean)));
  if (ids.length === 0) return {};

  const { data, error } = await supabase.from('shop_sellers').select('id, business_name').in('id', ids);

  if (error) {
    console.warn('Could not read the shop names:', error.message);
    return {};
  }

  return (data || []).reduce((map, row) => {
    map[row.id] = row;
    return map;
  }, {});
};
