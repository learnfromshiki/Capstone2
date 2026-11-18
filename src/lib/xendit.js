import { supabase } from './supabaseClient';

/**
 * Browser-side calls to the /api/xendit routes. The routes check the
 * person's Supabase session, so every call carries the access token.
 */

const authHeaders = async () => {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('Your session has expired. Please sign in again.');
  return { authorization: `Bearer ${token}` };
};

/** Is online payment (Xendit) switched on for this site? */
export const fetchOnlinePaymentEnabled = async () => {
  try {
    const response = await fetch('/api/xendit/checkout', { cache: 'no-store' });
    if (!response.ok) return false;
    const json = await response.json();
    return Boolean(json.enabled);
  } catch (error) {
    return false;
  }
};

/**
 * Open (or reopen) the Xendit payment page for a checkout and return its
 * address. Resolves to null when the checkout is already paid.
 */
export const startOnlinePayment = async (checkoutId) => {
  const response = await fetch('/api/xendit/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ checkoutId }),
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || 'Could not start the online payment.');
  if (json.alreadyPaid) return null;
  return json.checkoutUrl;
};

/** Ask the server whether this checkout has been paid. */
export const verifyOnlinePayment = async (checkoutId) => {
  const response = await fetch(`/api/xendit/verify?checkout=${encodeURIComponent(checkoutId)}`, {
    headers: await authHeaders(),
    cache: 'no-store',
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || 'Could not check the payment.');
  return json;
};

/**
 * An online order was just cancelled: close its payment link so nobody pays
 * for it. Best effort - the order is already cancelled either way, and a
 * payment that still slips through is flagged to the admin for a refund.
 */
export const releaseOnlinePayment = async (orderId) => {
  try {
    await fetch('/api/xendit/cancel', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ orderId }),
    });
  } catch (error) {
    console.warn('Could not close the payment link:', error?.message || error);
  }
};

/** Where Xendit sends the customer back to, for a checkout. */
export const returnPagePath = (checkoutId, status = 'success') =>
  `/shop/checkout/xendit?status=${status}&checkout=${checkoutId}`;
