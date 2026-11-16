import { NextResponse } from 'next/server';
import {
  loadCheckoutOrders,
  paymentMethodTypes,
  paymongoIsConfigured,
  paymongoRequest,
  siteOrigin,
  supabaseAdmin,
  userFromRequest,
} from '@/lib/paymongo.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const toCentavos = (amount) => Math.round((Number(amount) || 0) * 100);

/** Lets the checkout page know whether to offer online payment at all. */
export async function GET() {
  return NextResponse.json({ enabled: paymongoIsConfigured() });
}

/**
 * Open a PayMongo Checkout Session for one checkout (all of its shop orders)
 * and return the page the customer should be sent to.
 *
 * Body: { checkoutId }
 * Header: Authorization: Bearer <Supabase access token>
 */
export async function POST(request) {
  if (!paymongoIsConfigured()) {
    return NextResponse.json({ error: 'Online payment is not set up yet.' }, { status: 503 });
  }

  const admin = supabaseAdmin();
  const user = await userFromRequest(request, admin);
  if (!user) {
    return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });
  }

  const { checkoutId } = await request.json().catch(() => ({}));
  if (!checkoutId || !/^[0-9a-f-]{36}$/i.test(checkoutId)) {
    return NextResponse.json({ error: 'Missing checkout.' }, { status: 400 });
  }

  try {
    const orders = await loadCheckoutOrders(admin, checkoutId, user.id);

    if (orders.length === 0) {
      return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
    }
    if (orders.some((order) => order.payment_method !== 'paymongo')) {
      return NextResponse.json({ error: 'This order is not paid online.' }, { status: 400 });
    }
    if (orders.every((order) => order.payment_status === 'paid')) {
      return NextResponse.json({ alreadyPaid: true });
    }
    if (orders.some((order) => order.status === 'cancelled')) {
      return NextResponse.json(
        { error: 'This order was cancelled, so it can no longer be paid.' },
        { status: 409 }
      );
    }

    // Reuse a session that is still open rather than opening a second one.
    const existingSessionId = orders.find((order) => order.paymongo_session_id)?.paymongo_session_id;
    if (existingSessionId) {
      try {
        const { data: session } = await paymongoRequest(`/checkout_sessions/${existingSessionId}`);
        if (session?.attributes?.status === 'active' && session.attributes.checkout_url) {
          return NextResponse.json({ checkoutUrl: session.attributes.checkout_url });
        }
      } catch (error) {
        // Expired or unknown: fall through and open a new one.
      }
    }

    // What the customer sees on PayMongo's page. Prices come from the order
    // rows written by place_order(), never from the browser.
    const lineItems = [];
    orders.forEach((order) => {
      const shop = order.shop_sellers?.business_name;
      (order.shop_order_items || []).forEach((item) => {
        lineItems.push({
          name: (shop ? `${item.product_name} (${shop})` : item.product_name).slice(0, 255),
          quantity: Number(item.quantity),
          amount: toCentavos(item.price),
          currency: 'PHP',
        });
      });
      if (Number(order.shipping_fee) > 0) {
        lineItems.push({
          name: shop ? `Delivery fee (${shop})` : 'Delivery fee',
          quantity: 1,
          amount: toCentavos(order.shipping_fee),
          currency: 'PHP',
        });
      }
    });

    const expected = orders.reduce((sum, order) => sum + toCentavos(order.total_amount), 0);
    const charged = lineItems.reduce((sum, line) => sum + line.amount * line.quantity, 0);
    if (expected !== charged) {
      console.error('PayMongo totals do not match', { checkoutId, expected, charged });
      return NextResponse.json(
        { error: 'The order total could not be confirmed. Please contact the shop.' },
        { status: 409 }
      );
    }

    const origin = siteOrigin(request);
    const first = orders[0];
    const reference = `CD-${checkoutId.slice(0, 8).toUpperCase()}`;

    const { data: session } = await paymongoRequest('/checkout_sessions', {
      method: 'POST',
      body: {
        data: {
          attributes: {
            line_items: lineItems,
            payment_method_types: paymentMethodTypes(),
            description: `CONNECT-Daet order ${reference}`,
            reference_number: reference,
            send_email_receipt: true,
            show_description: true,
            show_line_items: true,
            billing: {
              name: first.customer_name || undefined,
              email: first.customer_email || undefined,
              phone: first.customer_phone || undefined,
            },
            metadata: { checkout_id: checkoutId, user_id: user.id },
            success_url: `${origin}/shop/checkout/paymongo?status=success&checkout=${checkoutId}`,
            cancel_url: `${origin}/shop/checkout/paymongo?status=cancelled&checkout=${checkoutId}`,
          },
        },
      },
    });

    const { error: saveError } = await admin
      .from('shop_orders')
      .update({ paymongo_session_id: session.id, updated_at: new Date().toISOString() })
      .eq('checkout_id', checkoutId)
      .eq('user_id', user.id);

    if (saveError) throw new Error(saveError.message);

    return NextResponse.json({ checkoutUrl: session.attributes.checkout_url });
  } catch (error) {
    console.error('Could not open the PayMongo checkout:', error);
    return NextResponse.json(
      { error: error.message || 'Could not start the online payment. Please try again.' },
      { status: 502 }
    );
  }
}
