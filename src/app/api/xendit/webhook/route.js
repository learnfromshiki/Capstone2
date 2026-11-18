import { NextResponse } from 'next/server';
import {
  applySessionStatus,
  checkoutIdFromSession,
  getSession,
  supabaseAdmin,
  verifyCallbackToken,
  xenditIsConfigured,
} from '@/lib/xendit.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Xendit webhook for Payment Sessions.
 *
 * In the Xendit Dashboard -> Settings -> Webhooks, point the Payment Session
 * events ("payment_session.completed" and "payment_session.expired") at
 *   https://<your-site>/api/xendit/webhook
 * and put the dashboard's webhook verification token in XENDIT_WEBHOOK_TOKEN.
 *
 * A 2xx answer tells Xendit the event was handled; anything else makes it
 * retry later (up to six times over a day).
 */
export async function POST(request) {
  if (!verifyCallbackToken(request.headers.get('x-callback-token'))) {
    return NextResponse.json({ error: 'Invalid callback token.' }, { status: 401 });
  }

  if (!xenditIsConfigured()) {
    return NextResponse.json({ error: 'Online payment is not set up yet.' }, { status: 503 });
  }

  let event;
  try {
    event = await request.json();
  } catch (error) {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }

  const type = event?.event;
  if (type !== 'payment_session.completed' && type !== 'payment_session.expired') {
    // Some other product's event: acknowledge so Xendit stops sending it.
    return NextResponse.json({ received: true });
  }

  const payload = event?.data || {};
  const sessionId = payload.payment_session_id;
  const checkoutId = checkoutIdFromSession(payload);

  if (!sessionId || !checkoutId) {
    // Not one of ours.
    return NextResponse.json({ received: true });
  }

  try {
    // Ask Xendit for the session itself rather than trusting the payload
    // alone; fall back to the payload if Xendit cannot be reached.
    let session = payload;
    try {
      session = await getSession(sessionId);
    } catch (error) {
      console.warn('Xendit webhook: could not re-read the session, using the payload.', error.message);
    }

    if (checkoutIdFromSession(session) && checkoutIdFromSession(session) !== checkoutId) {
      return NextResponse.json({ received: true });
    }

    await applySessionStatus(supabaseAdmin(), checkoutId, {
      ...session,
      payment_session_id: sessionId,
      status: session.status || (type === 'payment_session.completed' ? 'COMPLETED' : 'EXPIRED'),
    });
  } catch (error) {
    console.error('Xendit webhook could not update the orders:', error);
    // A 500 makes Xendit retry later.
    return NextResponse.json({ error: 'Could not update the order.' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
