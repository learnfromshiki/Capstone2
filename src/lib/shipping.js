import { supabase } from './supabaseClient';

/**
 * Delivery fees. The real figure is worked out in the database when the order
 * is placed (so it cannot be tampered with from the browser); this is the same
 * calculation, asked for in advance so checkout can show it.
 */
export const fetchShippingFee = async ({ province, city, subtotal }) => {
  try {
    const { data, error } = await supabase.rpc('shipping_fee_for', {
      p_province: province || null,
      p_city: city || null,
      p_subtotal: Number(subtotal) || 0,
    });

    if (error) {
      // Before supabase-shipping-chat-gallery.sql is run there is no fee yet.
      if (error.code === 'PGRST202' || /shipping_fee_for/i.test(error.message || '')) return 0;
      console.warn('Could not work out the delivery fee:', error.message);
      return 0;
    }

    return Number(data) || 0;
  } catch (error) {
    console.warn('Could not work out the delivery fee:', error?.message || error);
    return 0;
  }
};

export const listShippingRates = async () => {
  const { data, error } = await supabase
    .from('shop_shipping_rates')
    .select('*')
    .order('province', { nullsFirst: true })
    .order('city', { nullsFirst: true });

  if (error) {
    if (error.code === '42P01') return { rates: [], ready: false };
    throw new Error(error.message || 'Could not load the delivery fees.');
  }

  return { rates: data || [], ready: true };
};

/** "Anywhere else", "Camarines Norte", "Daet, Camarines Norte" */
export const describeArea = (rate) => {
  if (!rate?.province) return 'Anywhere else';
  if (!rate.city) return `${rate.province} (whole province)`;
  return `${rate.city}, ${rate.province}`;
};
