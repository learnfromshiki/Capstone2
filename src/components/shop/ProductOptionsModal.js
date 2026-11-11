'use client';

import { useEffect, useMemo, useState } from 'react';
import { describeSelection, missingChoices, readOptions } from '@/lib/productOptions';

/**
 * The sheet that opens on "Buy Now" (and on "Add to Cart" when a product has
 * choices to make), in the style shoppers know from Shopee and Lazada: the
 * picture and price on the left, the seller's options as chips, a quantity
 * stepper, and the running total.
 *
 * `intent` is 'buy' or 'cart' and decides which action is highlighted.
 */
export default function ProductOptionsModal({ product, intent = 'cart', onClose, onConfirm }) {
  const [selected, setSelected] = useState({});
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState('');

  const groups = useMemo(() => readOptions(product), [product]);
  const stock = Number(product?.stock) || 0;
  const price = Number(product?.price) || 0;

  // A fresh product means fresh choices
  useEffect(() => {
    setSelected({});
    setQuantity(1);
    setError('');
  }, [product?.id]);

  useEffect(() => {
    if (!product) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [product, onClose]);

  if (!product) return null;

  const changeQuantity = (next) => {
    if (next < 1) return;
    if (stock && next > stock) {
      setError(`Only ${stock} left in stock.`);
      return;
    }
    setError('');
    setQuantity(next);
  };

  const submit = (action) => {
    const missing = missingChoices(product, selected);
    if (missing.length > 0) {
      setError(`Please choose the ${missing.join(' and ').toLowerCase()}.`);
      return;
    }

    if (stock <= 0) {
      setError('This product is sold out.');
      return;
    }

    onConfirm({ product, quantity, selected, action });
  };

  const summary = describeSelection(selected);

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Choose options for ${product.name}`}
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
      >
        {/* Product summary */}
        <div className="relative flex gap-4 border-b p-5">
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute right-2 top-2 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <div className="h-24 w-24 flex-shrink-0 overflow-hidden rounded-xl bg-gray-100">
            {product.image_url ? (
              <img src={product.image_url} alt={product.name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-gray-400">No image</div>
            )}
          </div>

          <div className="min-w-0 flex-1 pr-10">
            <p className="text-2xl font-bold text-blue-600">₱{price.toFixed(2)}</p>
            <p className="truncate font-semibold text-gray-900">{product.name}</p>
            <p className={`text-sm ${stock > 0 ? 'text-gray-500' : 'font-semibold text-red-600'}`}>
              {stock > 0 ? `${stock} available` : 'Sold out'}
            </p>
            {summary && <p className="mt-1 truncate text-xs text-gray-500">{summary}</p>}
          </div>
        </div>

        <div className="space-y-5 p-5">
          {/* The seller's choices */}
          {groups.map((group) => (
            <div key={group.name}>
              <p className="mb-2 text-sm font-semibold text-gray-900">
                {group.name}
                <span className="ml-1 text-red-500">*</span>
              </p>
              <div className="flex flex-wrap gap-2">
                {group.values.map((optionValue) => {
                  const active = selected[group.name] === optionValue;
                  return (
                    <button
                      key={optionValue}
                      type="button"
                      onClick={() => {
                        setError('');
                        setSelected((current) => ({ ...current, [group.name]: optionValue }));
                      }}
                      aria-pressed={active}
                      className={`min-h-[44px] rounded-xl border-2 px-4 text-sm font-medium transition-colors ${
                        active
                          ? 'border-blue-600 bg-blue-50 text-blue-700'
                          : 'border-gray-200 text-gray-700 hover:border-gray-300'
                      }`}
                    >
                      {optionValue}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {groups.length === 0 && (
            <p className="text-sm text-gray-500">This product has no choices to make - just pick a quantity.</p>
          )}

          {/* Quantity */}
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-900">Quantity</p>
            <div className="flex items-center gap-3">
              <div className="flex items-center rounded-xl border border-gray-200">
                <button
                  type="button"
                  onClick={() => changeQuantity(quantity - 1)}
                  aria-label="Decrease quantity"
                  className="flex h-11 w-11 items-center justify-center text-lg font-bold text-gray-600 hover:bg-gray-50"
                >
                  −
                </button>
                <input
                  type="number"
                  min={1}
                  max={stock || 1}
                  value={quantity}
                  onChange={(event) => changeQuantity(Number(event.target.value) || 1)}
                  aria-label="Quantity"
                  className="w-14 border-0 text-center font-semibold focus:ring-0"
                />
                <button
                  type="button"
                  onClick={() => changeQuantity(quantity + 1)}
                  aria-label="Increase quantity"
                  className="flex h-11 w-11 items-center justify-center text-lg font-bold text-gray-600 hover:bg-gray-50"
                >
                  +
                </button>
              </div>
            </div>
          </div>

          {error && (
            <p role="alert" className="rounded-xl border-2 border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
              {error}
            </p>
          )}

          {/* Total */}
          <div className="flex items-center justify-between border-t pt-4">
            <span className="text-sm font-semibold text-gray-700">Total</span>
            <span className="text-2xl font-bold text-blue-600">₱{(price * quantity).toFixed(2)}</span>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => submit('cart')}
              disabled={stock <= 0}
              className={`min-h-[48px] flex-1 rounded-full border-2 border-blue-600 font-bold text-blue-600 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50 ${
                intent === 'cart' ? 'order-1' : 'order-2'
              }`}
            >
              Add to Cart
            </button>
            <button
              type="button"
              onClick={() => submit('buy')}
              disabled={stock <= 0}
              className={`min-h-[48px] flex-1 rounded-full bg-blue-600 font-bold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 ${
                intent === 'cart' ? 'order-2' : 'order-1'
              }`}
            >
              Buy Now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
