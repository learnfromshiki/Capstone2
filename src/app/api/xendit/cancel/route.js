import { NextResponse } from 'next/server';
import {
  cancelSession,
  getSession,
  supabaseAdmin,
  userFromRequest,
  xenditIsConfigured,
} from '@/lib/xendit.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An online order was cancelled before it was paid. Close its payment link so
 * the customer cannot pay for something that will not be sent. If the same
 * link also covered another shop's order that is still on, that order is
 * released and gets a new link (for the smaller amount) the next time the
 * customer taps "Pay now".
 *
 * Body: { orderId }
 * Header: Authorization: Bearer <Supabase access token>
 * Allowed for the customer, the shop on the order, and the admin.
 */
export async function POST(request) {
  if (!xenditIsConfigured()) {
    return NextResponse.json({ skipped: true });
  }

  const admin = supabaseAdmin();
  const user = await userFromRequest(request, admin);
  if (!user) {
    return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });
  }

  const { orderId } = await request.json().catch(() => ({}));
  if (!orderId || !UUID.test(orderId)) {
    return NextResponse.json({ error: 'Missing order.' }, { status: 400 });
  }

  try {
    const { data: order, error } = await admin
      .from('shop_orders')
      .select('id, user_id, seller_id, checkout_id, status, payment_method, payment_status, xendit_session_id')
      .eq('id', orderId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!order) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });

    // Who may close the link: the customer, the order's shop, or the admin.
    let allowed = order.user_id === user.id;
    if (!allowed) {
      const [{ data: profile }, { data: shop }] = await Promise.all([
        admin.from('profiles').select('user_type').eq('id', user.id).maybeSingle(),
        admin.from('shop_sellers').select('id').eq('user_id', user.id).maybeSingle(),
      ]);
      allowed = profile?.user_type === 'admin' || (shop?.id && shop.id === order.seller_id);
    }
    if (!allowed) return NextResponse.json({ error: 'Not your order.' }, { status: 403 });

    if (
      order.payment_method !== 'xendit' ||
      order.status !== 'cancelled' ||
      order.payment_status === 'paid' ||
      !order.xendit_session_id
    ) {
      return NextResponse.json({ skipped: true });
    }

    const session = await getSession(order.xendit_session_id);
    if (session.status === 'ACTIVE') {
      await cancelSession(order.xendit_session_id);
    }

    // Other orders of the checkout that are still on lose the closed link.
    const { error: releaseError } = await admin
      .from('shop_orders')
      .update({ xendit_session_id: null, updated_at: new Date().toISOString() })
      .eq('checkout_id', order.checkout_id)
      .eq('xendit_session_id', order.xendit_session_id)
      .neq('status', 'cancelled')
      .neq('payment_status', 'paid');
    if (releaseError) throw new Error(releaseError.message);

    return NextResponse.json({ closed: session.status === 'ACTIVE' });
  } catch (error) {
    console.error('Could not close the Xendit payment link:', error);
    return NextResponse.json({ error: 'Could not close the payment link.' }, { status: 502 });
  }
}
