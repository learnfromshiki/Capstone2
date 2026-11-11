'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import CheckoutModal from '@/components/shop/CheckoutModal';
import { cartLineId } from '@/lib/productOptions';
import { clearBuyNow, readBuyNow } from '@/lib/buyNow';

/**
 * The checkout page.
 *
 * Two ways in:
 *   /shop/checkout              - everything in the cart
 *   /shop/checkout?mode=buynow  - one item bought straight away, which is
 *                                never added to the cart
 */
export default function CheckoutPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [mode, setMode] = useState('cart');
  const [items, setItems] = useState([]);
  const [ready, setReady] = useState(false);

  const cartKey = user ? `shop_cart:${user.id}` : null;

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      router.push('/shop');
      return;
    }

    const requested =
      new URLSearchParams(window.location.search).get('mode') === 'buynow' ? 'buynow' : 'cart';
    setMode(requested);

    if (requested === 'buynow') {
      const line = readBuyNow(user.id);
      setItems(line ? [line] : []);
      setReady(true);
      return;
    }

    try {
      const stored = localStorage.getItem(cartKey);
      const parsed = stored ? JSON.parse(stored) : [];

      setItems(
        (Array.isArray(parsed) ? parsed : []).map((item) => ({
          ...item,
          productId: item.productId || item.id,
          selectedOptions: item.selectedOptions || {},
          lineId: item.lineId || cartLineId(item.productId || item.id, item.selectedOptions),
        }))
      );
    } catch (error) {
      console.error('Could not read your cart:', error);
      setItems([]);
    }

    setReady(true);
  }, [authLoading, user, router, cartKey]);

  const total = useMemo(
    () =>
      items.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 0), 0),
    [items]
  );

  const handleSuccess = () => {
    if (!user) return;

    if (mode === 'buynow') {
      clearBuyNow(user.id);
    } else {
      try {
        localStorage.removeItem(cartKey);
      } catch (error) {
        console.error('Could not clear your cart:', error);
      }
    }
  };

  if (authLoading || !ready) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href="/shop" className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white">
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
              </svg>
            </span>
            <span>
              <span className="block text-lg font-bold text-gray-900">Checkout</span>
              <span className="block text-xs text-gray-500">
                {mode === 'buynow' ? 'Buying one item' : 'Everything in your cart'}
              </span>
            </span>
          </Link>

          <Link href="/shop" className="min-h-[44px] text-sm font-medium text-blue-600 hover:text-blue-700">
            ← Keep shopping
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {items.length === 0 ? (
          <div className="mx-auto max-w-md rounded-2xl bg-white p-10 text-center shadow-sm">
            <h1 className="text-xl font-bold text-gray-900">Nothing to check out</h1>
            <p className="mt-2 text-sm text-gray-600">
              {mode === 'buynow'
                ? 'This purchase has already been completed, or the page was reloaded.'
                : 'Your cart is empty.'}
            </p>
            <Link
              href="/shop"
              className="mt-6 inline-flex min-h-[44px] items-center rounded-full bg-blue-600 px-6 font-bold text-white hover:bg-blue-700"
            >
              Browse the shop
            </Link>
          </div>
        ) : (
          <CheckoutModal
            variant="page"
            cart={items}
            total={total}
            onClose={() => router.push('/shop')}
            onSuccess={handleSuccess}
            onRequireAuth={() => router.push('/shop')}
          />
        )}
      </div>
    </main>
  );
}
