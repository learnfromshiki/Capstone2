import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

/**
 * Server-side PayMongo helpers. Never import this from a client component:
 * it reads the PayMongo secret key and the Supabase service role key.
 *
 * Environment variables (set them in .env.local and in Vercel):
 *   PAYMONGO_SECRET_KEY         sk_test_... or sk_live_...
 *   PAYMONGO_WEBHOOK_SECRET     whsk_... from the webhook you create in PayMongo
 *   PAYMONGO_PAYMENT_METHODS    optional, comma separated
 *                               (default: gcash,paymaya,card,grab_pay)
 *   SUPABASE_SERVICE_ROLE_KEY   Supabase -> Project Settings -> API keys
 *   NEXT_PUBLIC_SITE_URL        optional, e.g. https://your-site.vercel.app
 */

const PAYMONGO_API = 'https://api.paymongo.com/v1';
const DEFAULT_METHODS = ['gcash', 'paymaya', 'card', 'grab_pay'];

export const paymongoIsConfigured = () =>
  Boolean(process.env.PAYMONGO_SECRET_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY);

export const paymentMethodTypes = () => {
  const configured = (process.env.PAYMONGO_PAYMENT_METHODS || '')
    .split(',')
    .map((method) => method.trim())
    .filter(Boolean);
  return configured.length > 0 ? configured : DEFAULT_METHODS;
};

/** Supabase client that bypasses RLS. Server only. */
export const supabaseAdmin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

/** The signed-in user behind the request's "Authorization: Bearer <token>". */
export const userFromRequest = async (request, admin) => {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
};

export const paymongoRequest = async (path, { method = 'GET', body } = {}) => {
  const auth = Buffer.from(`${process.env.PAYMONGO_SECRET_KEY}:`).toString('base64');
  const response = await fetch(`${PAYMONGO_API}${path}`, {
    method,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Basic ${auth}`,
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = json?.errors?.[0]?.detail || `PayMongo returned ${response.status}.`;
    const error = new Error(detail);
    error.status = response.status;
    throw error;
  }

  return json;
};

/** Load every order of one checkout that belongs to this customer. */
export const loadCheckoutOrders = async (admin, checkoutId, userId) => {
  const { data, error } = await admin
    .from('shop_orders')
    .select(
      'id, user_id, seller_id, checkout_id, status, payment_method, payment_status, paymongo_session_id, total_amount, shipping_fee, customer_name, customer_email, customer_phone, shop_order_items(product_name, quantity, price), shop_sellers(business_name)'
    )
    .eq('checkout_id', checkoutId)
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  return data || [];
};

/** A paid PayMongo payment on this checkout session, if there is one. */
export const findPaidPayment = (session) =>
  (session?.attributes?.payments || []).find((payment) => payment?.attributes?.status === 'paid') ||
  null;

/**
 * Mark the orders of a checkout paid. Matching on the session id as well as
 * the checkout id means a payment can only ever settle the orders it was
 * opened for. Running it twice is harmless.
 */
export const markCheckoutPaid = async (admin, { checkoutId, sessionId, paymentId }) => {
  const { data, error } = await admin
    .from('shop_orders')
    .update({
      payment_status: 'paid',
      paid_at: new Date().toISOString(),
      payment_reference: paymentId || sessionId,
      updated_at: new Date().toISOString(),
    })
    .eq('checkout_id', checkoutId)
    .eq('paymongo_session_id', sessionId)
    .neq('payment_status', 'paid')
    .select('id');

  if (error) throw new Error(error.message);
  return data?.length || 0;
};

/**
 * Check the Paymongo-Signature header: "t=<timestamp>,te=<test sig>,li=<live sig>".
 * The signature is HMAC-SHA256 of "<timestamp>.<raw body>" with the webhook secret.
 */
export const verifyWebhookSignature = (rawBody, header, secret, toleranceSeconds = 300) => {
  if (!header || !secret) return false;

  const parts = Object.fromEntries(
    header.split(',').map((part) => {
      const index = part.indexOf('=');
      return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
    })
  );

  const timestamp = Number(parts.t);
  if (!timestamp) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false;

  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  return [parts.te, parts.li].some((candidate) => {
    if (!candidate) return false;
    const candidateBuffer = Buffer.from(candidate, 'utf8');
    return (
      candidateBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(candidateBuffer, expectedBuffer)
    );
  });
};

/** The site's own address, for PayMongo's success and cancel links. */
export const siteOrigin = (request) =>
  (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/$/, '') || new URL(request.url).origin;
