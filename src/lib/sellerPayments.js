import { supabase } from './supabaseClient';

/**
 * How each shop wants to be paid.
 *
 * A customer who picks GCash or Bank Transfer at checkout sees the shop's own
 * number (and QR code, if the shop uploaded one) and has to attach a photo of
 * the receipt before the order can be placed. The columns are added by
 * supabase-notifications-payments.sql.
 */

export const PAYMENT_COLUMNS =
  'gcash_name, gcash_number, gcash_qr_url, bank_name, bank_account_name, bank_account_number, bank_qr_url';

/** True when the shop payment columns have not been added yet. */
export const isMissingPaymentColumns = (error) =>
  /gcash_|bank_name|bank_account|column/i.test(error?.message || '');

export const EMPTY_PAYMENT_DETAILS = {
  gcash_name: '',
  gcash_number: '',
  gcash_qr_url: '',
  bank_name: '',
  bank_account_name: '',
  bank_account_number: '',
  bank_qr_url: '',
};

/** Normalise a seller row into a payment-details object the forms can edit. */
export const readPaymentDetails = (seller) => ({
  gcash_name: seller?.gcash_name || '',
  gcash_number: seller?.gcash_number || '',
  gcash_qr_url: seller?.gcash_qr_url || '',
  bank_name: seller?.bank_name || '',
  bank_account_name: seller?.bank_account_name || '',
  bank_account_number: seller?.bank_account_number || '',
  bank_qr_url: seller?.bank_qr_url || '',
});

/** Does this shop accept GCash / bank transfer at all? */
export const hasGcash = (seller) => Boolean(seller?.gcash_number || seller?.gcash_qr_url);
export const hasBank = (seller) =>
  Boolean(seller?.bank_account_number || seller?.bank_qr_url || seller?.bank_name);

export const acceptsMethod = (seller, method) => {
  if (method === 'gcash') return hasGcash(seller);
  if (method === 'bank') return hasBank(seller);
  return true; // Cash on delivery always works
};

/**
 * Fetch the payment details of several shops at once, for checkout.
 * Returns {} rather than failing when the columns are not there yet, so an
 * un-migrated database still checks out with the platform-wide details.
 */
export const fetchSellerPayments = async (sellerIds) => {
  const ids = Array.from(new Set((sellerIds || []).filter(Boolean)));
  if (ids.length === 0) return {};

  const { data, error } = await supabase
    .from('shop_sellers')
    .select(`id, business_name, ${PAYMENT_COLUMNS}`)
    .in('id', ids);

  if (error) {
    if (!isMissingPaymentColumns(error)) {
      console.warn('Could not read the shop payment details:', error.message);
    }
    return {};
  }

  return (data || []).reduce((map, row) => {
    map[row.id] = row;
    return map;
  }, {});
};

/** Save the signed-in shop's payment details. */
export const savePaymentDetails = async (sellerId, details) => {
  const clean = (value, max = 120) => (value || '').toString().trim().slice(0, max) || null;

  const payload = {
    gcash_name: clean(details.gcash_name),
    gcash_number: clean(details.gcash_number, 30),
    gcash_qr_url: clean(details.gcash_qr_url, 1000),
    bank_name: clean(details.bank_name),
    bank_account_name: clean(details.bank_account_name),
    bank_account_number: clean(details.bank_account_number, 40),
    bank_qr_url: clean(details.bank_qr_url, 1000),
  };

  const { error } = await supabase.from('shop_sellers').update(payload).eq('id', sellerId);

  if (error) {
    if (isMissingPaymentColumns(error)) {
      throw new Error(
        'Payment details are not set up yet. Ask the admin to run supabase-notifications-payments.sql in Supabase.'
      );
    }
    throw new Error(error.message || 'Could not save your payment details.');
  }

  return payload;
};

/** Attach the customer's receipt to an order that was just placed. */
export const attachPaymentProof = async (orderId, url, reference = null) => {
  const { error } = await supabase.rpc('attach_payment_proof', {
    p_order_id: orderId,
    p_url: url,
    p_reference: reference,
  });

  if (error) {
    console.warn('Could not attach the payment receipt:', error.message);
    return false;
  }

  return true;
};
