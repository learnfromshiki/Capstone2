import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

/**
 * Server-side Xendit helpers (Payment Sessions API). Never import this from a
 * client component: it reads the Xendit secret key and the Supabase service
 * role key.
 *
 * Environment variables (set them in .env.local and in Vercel):
 *   XENDIT_SECRET_KEY          xnd_development_... or xnd_production_...
 *                              (Xendit Dashboard -> Settings -> API keys)
 *   XENDIT_WEBHOOK_TOKEN       the webhook verification token
 *                              (Xendit Dashboard -> Settings -> Webhooks)
 *   XENDIT_PAYMENT_CHANNELS    optional, comma separated, e.g.
 *                              GCASH,PAYMAYA,GRABPAY,SHOPEEPAY,QRPH,CARDS
 *                              (leave empty to offer every channel the
 *                              Xendit account has switched on)
 *   SUPABASE_SERVICE_ROLE_KEY  Supabase -> Project Settings -> API keys
 *   NEXT_PUBLIC_SITE_URL       optional, e.g. https://your-site.vercel.app
 */

const XENDIT_API = 'https://api.xendit.co';

/** How long a payment link stays open. An unpaid order is cancelled after. */
export const SESSION_HOURS = 24;

export const xenditIsConfigured = () =>
  Boolean(
    process.env.XENDIT_SECRET_KEY &&
      process.env.SUPABASE_SERVICE_ROLE_KEY &&
      process.env.NEXT_PUBLIC_SUPABASE_URL
  );

export const allowedPaymentChannels = () =>
  (process.env.XENDIT_PAYMENT_CHANNELS || '')
    .split(',')
    .map((channel) => channel.trim().toUpperCase())
    .filter(Boolean);

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

/** Call the Xendit API with the secret key (HTTP Basic, key as username). */
export const xenditRequest = async (path, { method = 'GET', body } = {}) => {
  const auth = Buffer.from(`${process.env.XENDIT_SECRET_KEY}:`).toString('base64');
  const response = await fetch(`${XENDIT_API}${path}`, {
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
    const detail =
      json?.message ||
      (Array.isArray(json?.errors) && json.errors.length > 0
        ? json.errors.map((entry) => (typeof entry === 'string' ? entry : entry?.message)).filter(Boolean).join(' ')
        : '') ||
      `Xendit returned ${response.status}.`;
    const error = new Error(detail);
    error.status = response.status;
    error.code = json?.error_code;
    throw error;
  }

  return json;
};

export const getSession = (sessionId) => xenditRequest(`/sessions/${encodeURIComponent(sessionId)}`);

export const cancelSession = (sessionId) =>
  xenditRequest(`/sessions/${encodeURIComponent(sessionId)}/cancel`, { method: 'POST' });

/** Columns the payment routes need for every order of a checkout. */
const CHECKOUT_COLUMNS =
  'id, user_id, seller_id, checkout_id, status, payment_method, payment_status, xendit_session_id, total_amount, shipping_fee, points_redeemed, points_discount, customer_name, customer_email, customer_phone, shop_order_items(product_name, quantity, price), shop_sellers(business_name)';

/**
 * Every order of one checkout. With a userId, only that customer's orders
 * (the customer is paying); without, every order (an admin or seller acting).
 */
export const loadCheckoutOrders = async (admin, checkoutId, userId = null) => {
  let query = admin
    .from('shop_orders')
    .select(CHECKOUT_COLUMNS)
    .eq('checkout_id', checkoutId)
    .order('created_at', { ascending: true });

  if (userId) query = query.eq('user_id', userId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
};

/** Orders of a checkout that still have to be paid. */
export const payableOrders = (orders) =>
  orders.filter(
    (order) =>
      order.payment_method === 'xendit' && order.status !== 'cancelled' && order.payment_status !== 'paid'
  );

/**
 * Settle the orders of a checkout that were waiting for this session. Done in
 * the database (xendit_mark_checkout_paid), which also tells each shop the
 * order can be prepared and the admin if a refund is needed.
 */
export const markCheckoutPaid = async (admin, { checkoutId, sessionId, paymentId }) => {
  const { data, error } = await admin.rpc('xendit_mark_checkout_paid', {
    p_checkout_id: checkoutId,
    p_session_id: sessionId,
    p_payment_id: paymentId || null,
  });
  if (error) throw new Error(error.message);
  return data || { paid: 0, refunds_needed: 0 };
};

/** The link expired unpaid: cancel the orders still waiting for it. */
export const markSessionExpired = async (admin, { checkoutId, sessionId }) => {
  const { data, error } = await admin.rpc('xendit_session_expired', {
    p_checkout_id: checkoutId,
    p_session_id: sessionId,
  });
  if (error) throw new Error(error.message);
  return Number(data) || 0;
};

/**
 * The checkout id a session belongs to. reference_id is "<checkout id>-<n>"
 * and the checkout id is also in the metadata.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const checkoutIdFromSession = (session) => {
  const fromMetadata = session?.metadata?.checkout_id;
  if (typeof fromMetadata === 'string' && UUID.test(fromMetadata)) return fromMetadata;
  const fromReference = String(session?.reference_id || '').slice(0, 36);
  return UUID.test(fromReference) ? fromReference : null;
};

export const referenceFor = (checkoutId) => `${checkoutId}-${Date.now().toString(36)}`;

/**
 * Bring the orders in line with what Xendit says about their session.
 * Returns 'paid', 'expired' or 'open'.
 */
export const applySessionStatus = async (admin, checkoutId, session) => {
  const sessionId = session?.payment_session_id;
  if (!sessionId) return 'open';

  if (session.status === 'COMPLETED') {
    await markCheckoutPaid(admin, {
      checkoutId,
      sessionId,
      paymentId: session.payment_id || session.payment_request_id || null,
    });
    return 'paid';
  }

  if (session.status === 'EXPIRED') {
    await markSessionExpired(admin, { checkoutId, sessionId });
    return 'expired';
  }

  // ACTIVE, or CANCELED (we cancel a link ourselves when an order of it is
  // cancelled, and the rest of the checkout can then get a new one).
  return 'open';
};

/** Compare the webhook's x-callback-token with ours, in constant time. */
export const verifyCallbackToken = (header) => {
  const expected = process.env.XENDIT_WEBHOOK_TOKEN || '';
  if (!expected || !header) return false;
  const a = Buffer.from(String(header), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

/** The site's own address, for Xendit's return links. */
export const siteOrigin = (request) =>
  (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/$/, '') || new URL(request.url).origin;

const centavos = (amount) => Math.round((Number(amount) || 0) * 100);
const pesos = (cents) => cents / 100;

/** 09171234567 -> +639171234567 (E.164). Anything else is left out. */
export const toE164 = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');
  if (/^09\d{9}$/.test(digits)) return `+63${digits.slice(1)}`;
  if (/^639\d{9}$/.test(digits)) return `+${digits}`;
  return null;
};

/**
 * What the customer sees on Xendit's page. Prices come from the order rows
 * written by place_order(), never from the browser, and the lines always add
 * up to exactly the amount charged.
 */
export const buildSessionItems = (orders) => {
  const items = [];

  orders.forEach((order) => {
    const shop = order.shop_sellers?.business_name || 'CONNECT-Daet';
    const number = String(order.id).slice(0, 8).toUpperCase();
    const lines = order.shop_order_items || [];
    const itemsCents = lines.reduce((sum, line) => sum + centavos(line.price) * Number(line.quantity), 0);
    const shippingCents = centavos(order.shipping_fee);

    // An order partly paid with reward points (or whose lines do not add up
    // for any reason) is one line for what is left to pay; Xendit has no
    // negative lines for a discount.
    if (Number(order.points_discount) > 0 || itemsCents + shippingCents !== centavos(order.total_amount)) {
      items.push({
        reference_id: `order-${number}`,
        type: 'PHYSICAL_PRODUCT',
        name: `Order #${number} from ${shop}${Number(order.points_redeemed) > 0 ? `, less ${order.points_redeemed} reward points` : ''}`.slice(0, 255),
        net_unit_amount: pesos(centavos(order.total_amount)),
        quantity: 1,
        category: 'Local products',
      });
      return;
    }

    lines.forEach((line, index) => {
      items.push({
        reference_id: `${number}-${index + 1}`,
        type: 'PHYSICAL_PRODUCT',
        name: `${line.product_name} (${shop})`.slice(0, 255),
        net_unit_amount: pesos(centavos(line.price)),
        quantity: Number(line.quantity),
        category: 'Local products',
      });
    });

    if (shippingCents > 0) {
      items.push({
        reference_id: `${number}-delivery`,
        type: 'FEE',
        name: `Delivery fee (${shop})`.slice(0, 255),
        net_unit_amount: pesos(shippingCents),
        quantity: 1,
        category: 'Delivery',
      });
    }
  });

  return items;
};

export const totalOf = (orders) => pesos(orders.reduce((sum, order) => sum + centavos(order.total_amount), 0));

/** The customer as Xendit wants it. Optional fields are left out when unsure. */
export const buildCustomer = (order, userId) => {
  const name = String(order.customer_name || '').trim().replace(/\s+/g, ' ');
  const [given, ...rest] = name.split(' ');
  const email = String(order.customer_email || '').trim();
  const mobile = toE164(order.customer_phone);

  return {
    type: 'INDIVIDUAL',
    reference_id: String(userId).replace(/[^a-zA-Z0-9]/g, ''),
    individual_detail: {
      given_names: (given || 'Customer').slice(0, 50),
      ...(rest.length > 0 ? { surname: rest.join(' ').slice(0, 50) } : {}),
    },
    ...(email && email.length <= 50 ? { email } : {}),
    ...(mobile ? { mobile_number: mobile } : {}),
  };
};
