import { supabase } from './supabaseClient';

/**
 * Browser-side calls to the /api/paymongo routes. The routes check the
 * customer's Supabase session, so every call carries the access token.
 */

const authHeaders = async () => {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('Your session has expired. Please sign in again.');
  return { authorization: `Bearer ${token}` };
};

/** Is online payment switched on for this site? */
export const fetchPaymongoEnabled = async () => {
  try {
    const response = await fetch('/api/paymongo/checkout', { cache: 'no-store' });
    if (!response.ok) return false;
    const json = await response.json();
    return Boolean(json.enabled);
  } catch (error) {
    return false;
  }
};

/**
 * Open (or reopen) the PayMongo page for a checkout and return its address.
 * Resolves to null when the checkout is already paid.
 */
export const startPaymongoCheckout = async (checkoutId) => {
  const response = await fetch('/api/paymongo/checkout', {
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
export const verifyPaymongoCheckout = async (checkoutId) => {
  const response = await fetch(`/api/paymongo/verify?checkout=${encodeURIComponent(checkoutId)}`, {
    headers: await authHeaders(),
    cache: 'no-store',
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || 'Could not check the payment.');
  return json;
};
