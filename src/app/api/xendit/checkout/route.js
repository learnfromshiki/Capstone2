import { NextResponse } from 'next/server';
import {
  SESSION_HOURS,
  allowedPaymentChannels,
  applySessionStatus,
  buildCustomer,
  buildSessionItems,
  cancelSession,
  getSession,
  loadCheckoutOrders,
  payableOrders,
  referenceFor,
  siteOrigin,
  supabaseAdmin,
  totalOf,
  userFromRequest,
  xenditIsConfigured,
  xenditRequest,
} from '@/lib/xendit.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lets the checkout page know whether to offer online payment at all. */
export async function GET() {
  return NextResponse.json({ enabled: xenditIsConfigured() });
}

/**
 * Open (or reopen) the Xendit payment page for one checkout - every shop's
 * order in it that still has to be paid - and return its address.
 *
 * Body: { checkoutId }
 * Header: Authorization: Bearer <Supabase access token>
 */
export async function POST(request) {
  if (!xenditIsConfigured()) {
    return NextResponse.json({ error: 'Online payment is not set up yet.' }, { status: 503 });
  }

  const admin = supabaseAdmin();
  const user = await userFromRequest(request, admin);
  if (!user) {
    return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });
  }

  const { checkoutId } = await request.json().catch(() => ({}));
  if (!checkoutId || !UUID.test(checkoutId)) {
    return NextResponse.json({ error: 'Missing checkout.' }, { status: 400 });
  }

  try {
    const orders = await loadCheckoutOrders(admin, checkoutId, user.id);

    if (orders.length === 0) {
      return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
    }
    if (orders.some((order) => order.payment_method !== 'xendit')) {
      return NextResponse.json({ error: 'This order is not paid online.' }, { status: 400 });
    }

    let payable = payableOrders(orders);
    if (payable.length === 0) {
      if (orders.every((order) => order.payment_status === 'paid')) {
        return NextResponse.json({ alreadyPaid: true });
      }
      return NextResponse.json(
        { error: 'This order was cancelled, so it can no longer be paid.' },
        { status: 409 }
      );
    }

    // A link that is still open is reused, so the customer never pays twice.
    const existingId = payable.find((order) => order.xendit_session_id)?.xendit_session_id;
    if (existingId) {
      const session = await getSession(existingId);

      if (session.status === 'ACTIVE' && session.payment_link_url) {
        return NextResponse.json({ checkoutUrl: session.payment_link_url });
      }

      const outcome = await applySessionStatus(admin, checkoutId, session);
      if (outcome === 'paid') return NextResponse.json({ alreadyPaid: true });
      if (outcome === 'expired') {
        return NextResponse.json(
          {
            error: `The payment link expired after ${SESSION_HOURS} hours, so the order was cancelled and its items went back on sale. Please order again.`,
          },
          { status: 409 }
        );
      }

      // Cancelled link: release it, and whatever is still unpaid gets a new
      // one below.
      const { error: releaseError } = await admin
        .from('shop_orders')
        .update({ xendit_session_id: null, updated_at: new Date().toISOString() })
        .eq('checkout_id', checkoutId)
        .eq('xendit_session_id', existingId)
        .neq('payment_status', 'paid')
        .neq('status', 'cancelled');
      if (releaseError) throw new Error(releaseError.message);

      payable = payableOrders(await loadCheckoutOrders(admin, checkoutId, user.id));
      if (payable.length === 0) {
        return NextResponse.json({ error: 'There is nothing left to pay on this order.' }, { status: 409 });
      }
    }

    const amount = totalOf(payable);
    const items = buildSessionItems(payable);
    const origin = siteOrigin(request);
    const secure = origin.startsWith('https://');
    const first = payable[0];
    const shortRef = `CD-${checkoutId.slice(0, 8).toUpperCase()}`;
    const channels = allowedPaymentChannels();

    const body = {
      reference_id: referenceFor(checkoutId),
      session_type: 'PAY',
      mode: 'PAYMENT_LINK',
      country: 'PH',
      currency: 'PHP',
      amount,
      capture_method: 'AUTOMATIC',
      locale: 'en',
      description: `CONNECT-Daet order ${shortRef}`,
      expires_at: new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000).toISOString(),
      customer: buildCustomer(first, user.id),
      items,
      metadata: { checkout_id: checkoutId, order_ref: shortRef },
      ...(channels.length > 0 ? { allowed_payment_channels: channels } : {}),
      // Xendit only accepts https return links, so a local http preview
      // leaves the customer on Xendit's own receipt page instead.
      ...(secure
        ? {
            success_return_url: `${origin}/shop/checkout/xendit?status=success&checkout=${checkoutId}`,
            cancel_return_url: `${origin}/shop/checkout/xendit?status=cancelled&checkout=${checkoutId}`,
          }
        : {}),
    };

    let session;
    try {
      session = await xenditRequest('/sessions', { method: 'POST', body });
    } catch (error) {
      // A customer record Xendit already knows under this reference: try
      // once more with a fresh one rather than failing the payment.
      if (/customer|duplicate/i.test(`${error.code || ''} ${error.message || ''}`)) {
        body.customer = {
          ...body.customer,
          reference_id: `${body.customer.reference_id}${Date.now().toString(36)}`.slice(0, 60),
        };
        session = await xenditRequest('/sessions', { method: 'POST', body });
      } else {
        throw error;
      }
    }

    // Store the link on the orders it pays for. "Only if none is stored yet"
    // stops two clicks at once from leaving two live links.
    const { data: claimed, error: saveError } = await admin
      .from('shop_orders')
      .update({ xendit_session_id: session.payment_session_id, updated_at: new Date().toISOString() })
      .in('id', payable.map((order) => order.id))
      .is('xendit_session_id', null)
      .select('id');

    if (saveError) throw new Error(saveError.message);

    if (!claimed || claimed.length !== payable.length) {
      // Someone else opened a link first: close ours and use theirs.
      await cancelSession(session.payment_session_id).catch(() => {});
      const fresh = payableOrders(await loadCheckoutOrders(admin, checkoutId, user.id));
      const otherId = fresh.find((order) => order.xendit_session_id)?.xendit_session_id;
      if (otherId) {
        const other = await getSession(otherId);
        if (other.status === 'ACTIVE' && other.payment_link_url) {
          return NextResponse.json({ checkoutUrl: other.payment_link_url });
        }
      }
      return NextResponse.json({ error: 'Please try again.' }, { status: 409 });
    }

    return NextResponse.json({ checkoutUrl: session.payment_link_url });
  } catch (error) {
    console.error('Could not open the Xendit payment page:', error);
    return NextResponse.json(
      { error: error.message || 'Could not start the online payment. Please try again.' },
      { status: 502 }
    );
  }
}
