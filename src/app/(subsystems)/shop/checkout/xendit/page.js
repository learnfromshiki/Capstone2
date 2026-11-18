'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { formatOrderNumber } from '@/lib/orders';
import { startPaymongoCheckout, verifyPaymongoCheckout } from '@/lib/paymongo';

/**
 * Where PayMongo sends the customer back to.
 *
 *   ?status=success&checkout=<id>    paid (or still being confirmed)
 *   ?status=cancelled&checkout=<id>  left the PayMongo page without paying
 *
 * The page never trusts the "status" in the address: it asks the server,
 * which asks PayMongo.
 */
export default function PaymongoReturnPage() {
  const { user, loading: authLoading } = useAuth();
  const [checkoutId, setCheckoutId] = useState('');
  const [returned, setReturned] = useState('success');
  const [state, setState] = useState('checking'); // checking | paid | unpaid | error
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState('');
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setCheckoutId(params.get('checkout') || '');
    setReturned(params.get('status') === 'cancelled' ? 'cancelled' : 'success');
  }, []);

  const check = useCallback(async (id, attempts) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const json = await verifyPaymongoCheckout(id);
        setResult(json);
        if (json.paid) {
          setState('paid');
          return;
        }
      } catch (error) {
        setMessage(error.message);
        setState('error');
        return;
      }
      // E-wallet payments can take a few seconds to settle.
      if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    setState('unpaid');
  }, []);

  useEffect(() => {
    if (authLoading || !checkoutId) return;
    if (!user) {
      setState('error');
      setMessage('Please sign in to see this order.');
      return;
    }
    check(checkoutId, returned === 'success' ? 4 : 1);
  }, [authLoading, user, checkoutId, returned, check]);

  const payAgain = async () => {
    setRetrying(true);
    setMessage('');
    try {
      const url = await startPaymongoCheckout(checkoutId);
      if (url) window.location.assign(url);
      else check(checkoutId, 1);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setRetrying(false);
    }
  };

  const orderNumbers = (result?.orders || []).map((order) => formatOrderNumber(order.id));

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
        {state === 'checking' && (
          <>
            <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600" />
            <h1 className="text-xl font-bold text-gray-900">Confirming your payment...</h1>
            <p className="mt-2 text-sm text-gray-600">This only takes a moment.</p>
          </>
        )}

        {state === 'paid' && (
          <>
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-green-100">
              <svg className="h-10 w-10 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Payment received!</h1>
            <p className="mt-2 text-gray-600">
              Thank you for supporting local artisans of Daet. The shop will prepare your order now.
            </p>
          </>
        )}

        {state === 'unpaid' && (
          <>
            <h1 className="text-2xl font-bold text-gray-900">
              {returned === 'cancelled' ? 'Payment not completed' : 'Payment still pending'}
            </h1>
            <p className="mt-2 text-gray-600">
              {returned === 'cancelled'
                ? 'Your order is saved, but it has not been paid yet.'
                : 'We have not received the payment yet. If you already paid, it will show up in My Orders shortly.'}
            </p>
            <button
              type="button"
              onClick={payAgain}
              disabled={retrying}
              className="mt-6 min-h-[44px] w-full rounded-full bg-blue-600 font-bold text-white hover:bg-blue-700 disabled:bg-gray-400"
            >
              {retrying ? 'Opening PayMongo...' : 'Pay now'}
            </button>
          </>
        )}

        {state === 'error' && (
          <>
            <h1 className="text-xl font-bold text-gray-900">We could not check this payment</h1>
            <p className="mt-2 text-sm text-gray-600">{message || 'Please check My Orders.'}</p>
          </>
        )}

        {state !== 'error' && message && <p className="mt-3 text-sm text-red-600">{message}</p>}

        {orderNumbers.length > 0 && (
          <div className="mt-6 rounded-xl bg-gray-50 p-4 text-sm text-gray-700">
            <p>
              {orderNumbers.length === 1 ? 'Order number' : 'Order numbers'}:{' '}
              <span className="font-mono font-semibold text-gray-900">{orderNumbers.join(', ')}</span>
            </p>
            <p className="mt-1">
              Total: <span className="font-semibold">₱{Number(result?.total || 0).toFixed(2)}</span>
            </p>
          </div>
        )}

        <Link
          href="/shop/buyer?tab=orders"
          className="mt-6 inline-flex min-h-[44px] w-full items-center justify-center rounded-full border-2 border-blue-600 font-bold text-blue-600 hover:bg-blue-50"
        >
          Go to My Orders
        </Link>
        <Link href="/shop" className="mt-3 inline-block text-sm font-medium text-blue-600 hover:text-blue-700">
          Continue shopping
        </Link>
      </div>
    </main>
  );
}
