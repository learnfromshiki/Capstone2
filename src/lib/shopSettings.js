import { supabase } from './supabaseClient';

/**
 * Website settings the admin edits in Admin → Settings. Stored as key/value rows
 * in shop_settings, which everyone may read (the contact details are public).
 * Buyers pay online through Xendit or in cash, so there are no payment
 * account details here.
 */
export const DEFAULT_SHOP_SETTINGS = {
  siteName: 'Daet Local Shop',
  contactEmail: 'support@connect-daet.ph',
  contactPhone: '+63 900 000 0000',
};

let cachedSettings = null;
let pendingRequest = null;

export const fetchShopSettings = async ({ force = false } = {}) => {
  if (cachedSettings && !force) return cachedSettings;
  if (pendingRequest && !force) return pendingRequest;

  pendingRequest = (async () => {
    try {
      const { data, error } = await supabase.from('shop_settings').select('key, value');

      if (error) {
        console.warn('Website settings are unavailable:', error.message);
        return { ...DEFAULT_SHOP_SETTINGS };
      }

      const stored = (data || []).reduce((acc, row) => {
        if (row?.key) acc[row.key] = row.value ?? '';
        return acc;
      }, {});

      cachedSettings = { ...DEFAULT_SHOP_SETTINGS, ...stored };
      return cachedSettings;
    } catch (error) {
      console.warn('Website settings are unavailable:', error?.message || error);
      return { ...DEFAULT_SHOP_SETTINGS };
    } finally {
      pendingRequest = null;
    }
  })();

  return pendingRequest;
};
