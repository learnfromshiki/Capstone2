import { NextResponse } from 'next/server';
import {
  findPaidPayment,
  markCheckoutPaid,
  supabaseAdmin,
  verifyWebhookSignature,
} from '@/lib/paymongo.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PayMongo webhook. Create it in the PayMongo dashboard (Developers ->
 * Webhooks) pointing at https://<your-site>/api/paymongo/webhook with the
 * event "checkout_session.payment.paid", and put its secret key in
 * PAYMONGO_WEBHOOK_SECRET.
 */
export async function POST(request) {
  const rawBody = await request.text();
  const signature = request.headers.get('paymongo-signature');

  if (!verifyWebhookSignature(rawBody, signature, process.env.PAYMONGO_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (error) {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }

  const type = event?.data?.attributes?.type;

  if (type === 'checkout_session.payment.paid') {
    const session = event.data.attributes.data;
    const checkoutId = session?.attributes?.metadata?.checkout_id;
    const payment = findPaidPayment(session) || session?.attributes?.payments?.[0];

    if (!checkoutId || !session?.id) {
      // Not one of ours; acknowledge so PayMongo stops retrying.
      return NextResponse.json({ received: true });
    }

    try {
      await markCheckoutPaid(supabaseAdmin(), {
        checkoutId,
        sessionId: session.id,
        paymentId: payment?.id,
      });
    } catch (error) {
      console.error('PayMongo webhook could not update the orders:', error);
      // A 500 makes PayMongo retry later.
      return NextResponse.json({ error: 'Could not update the order.' }, { status: 500 });
    }
  }

  return NextResponse.json({ received: true });
}
