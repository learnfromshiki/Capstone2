import { NextResponse } from 'next/server';
import {
  findPaidPayment,
  loadCheckoutOrders,
  markCheckoutPaid,
  paymongoIsConfigured,
  paymongoRequest,
  supabaseAdmin,
  userFromRequest,
} from '@/lib/paymongo.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Called by the page the customer lands on after PayMongo. Asks PayMongo
 * directly whether the session was paid, so the order is updated even when
 * the webhook has not arrived yet (or cannot reach a local dev server).
 *
 * Query: ?checkout=<checkout id>
 * Header: Authorization: Bearer <Supabase access token>
 */
export async function GET(request) {
  if (!paymongoIsConfigured()) {
    return NextResponse.json({ error: 'Online payment is not set up yet.' }, { status: 503 });
  }

  const admin = supabaseAdmin();
  const user = await userFromRequest(request, admin);
  if (!user) {
    return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });
  }

  const checkoutId = new URL(request.url).searchParams.get('checkout') || '';
  if (!/^[0-9a-f-]{36}$/i.test(checkoutId)) {
    return NextResponse.json({ error: 'Missing checkout.' }, { status: 400 });
  }

  try {
    const orders = await loadCheckoutOrders(admin, checkoutId, user.id);
    if (orders.length === 0) {
      return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
    }

    const summary = () =>
      orders.map((order) => ({
        id: order.id,
        total: Number(order.total_amount) || 0,
        status: order.status,
      }));
    const total = orders.reduce((sum, order) => sum + (Number(order.total_amount) || 0), 0);

    if (orders.every((order) => order.payment_status === 'paid')) {
      return NextResponse.json({ paid: true, orders: summary(), total });
    }

    const sessionId = orders.find((order) => order.paymongo_session_id)?.paymongo_session_id;
    if (!sessionId) {
      return NextResponse.json({ paid: false, orders: summary(), total });
    }

    const { data: session } = await paymongoRequest(`/checkout_sessions/${sessionId}`);
    const payment = findPaidPayment(session);

    if (payment && session?.attributes?.metadata?.checkout_id === checkoutId) {
      await markCheckoutPaid(admin, { checkoutId, sessionId, paymentId: payment.id });
      return NextResponse.json({ paid: true, orders: summary(), total });
    }

    return NextResponse.json({ paid: false, orders: summary(), total });
  } catch (error) {
    console.error('Could not verify the PayMongo payment:', error);
    return NextResponse.json({ error: 'Could not check the payment yet.' }, { status: 502 });
  }
}
