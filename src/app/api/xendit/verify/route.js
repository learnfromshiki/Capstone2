import { NextResponse } from 'next/server';
import {
  applySessionStatus,
  getSession,
  loadCheckoutOrders,
  supabaseAdmin,
  userFromRequest,
  xenditIsConfigured,
} from '@/lib/xendit.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Called by the page the customer lands on after Xendit. Asks Xendit directly
 * about the payment link, so the order is updated even when the webhook has
 * not arrived yet (or cannot reach a local dev server).
 *
 * Query: ?checkout=<checkout id>
 * Header: Authorization: Bearer <Supabase access token>
 */
export async function GET(request) {
  if (!xenditIsConfigured()) {
    return NextResponse.json({ error: 'Online payment is not set up yet.' }, { status: 503 });
  }

  const admin = supabaseAdmin();
  const user = await userFromRequest(request, admin);
  if (!user) {
    return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });
  }

  const checkoutId = new URL(request.url).searchParams.get('checkout') || '';
  if (!UUID.test(checkoutId)) {
    return NextResponse.json({ error: 'Missing checkout.' }, { status: 400 });
  }

  try {
    let orders = await loadCheckoutOrders(admin, checkoutId, user.id);
    if (orders.length === 0) {
      return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
    }

    const summary = () => ({
      orders: orders.map((order) => ({
        id: order.id,
        total: Number(order.total_amount) || 0,
        status: order.status,
      })),
      total: orders
        .filter((order) => order.status !== 'cancelled')
        .reduce((sum, order) => sum + (Number(order.total_amount) || 0), 0),
    });

    const live = orders.filter((order) => order.status !== 'cancelled');
    if (live.length > 0 && live.every((order) => order.payment_status === 'paid')) {
      return NextResponse.json({ paid: true, ...summary() });
    }

    const sessionId = live.find((order) => order.xendit_session_id)?.xendit_session_id;
    if (!sessionId) {
      return NextResponse.json({ paid: false, expired: live.length === 0, ...summary() });
    }

    const session = await getSession(sessionId);
    const outcome = await applySessionStatus(admin, checkoutId, session);
    orders = await loadCheckoutOrders(admin, checkoutId, user.id);

    return NextResponse.json({
      paid: outcome === 'paid',
      expired: outcome === 'expired',
      ...summary(),
    });
  } catch (error) {
    console.error('Could not verify the Xendit payment:', error);
    return NextResponse.json({ error: 'Could not check the payment yet.' }, { status: 502 });
  }
}
