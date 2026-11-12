'use client';

import { useEffect, useState } from 'react';
import { describeSelection } from '@/lib/productOptions';
import { useDialog } from '@/components/ui/Dialog';
import { storeSelection } from '@/lib/checkoutSelection';

export default function Cart({ cart, isOpen, onClose, onUpdateQuantity, onRemoveItem, userId }) {
  const { showConfirm } = useDialog();
  // Which lines are going through checkout. Everything starts ticked, so the
  // common case - buy the lot - is still one tap.
  const [selected, setSelected] = useState([]);

  // A new line is ticked by default; a removed one stops counting.
  useEffect(() => {
    setSelected((current) => {
      const present = cart.map((item) => item.lineId);
      const kept = current.filter((lineId) => present.includes(lineId));
      const added = present.filter((lineId) => !current.includes(lineId));
      return [...kept, ...added];
    });
  }, [cart]);

  const toggleLine = (lineId) =>
    setSelected((current) =>
      current.includes(lineId) ? current.filter((id) => id !== lineId) : [...current, lineId]
    );

  const isSoldOut = (item) => (Number(item.stock) || 0) <= 0;

  const sellable = cart.filter((item) => (Number(item.stock) || 0) > 0);
  const allSelected = sellable.length > 0 && selectedItems.length === sellable.length;
  const selectedItems = cart.filter((item) => selected.includes(item.lineId) && !isSoldOut(item));
  const selectedTotal = selectedItems.reduce(
    (sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 0),
    0
  );

  /** Removing something from the cart is easy to do by accident, so ask. */
  const confirmRemove = async (item) => {
    const confirmed = await showConfirm({
      tone: 'warning',
      title: 'Remove this item?',
      message: `"${item.name}" will be taken out of your cart.`,
      confirmLabel: 'Remove',
      cancelLabel: 'Keep it',
    });

    if (confirmed) onRemoveItem(item.lineId);
  };

  // Escape closes the cart
  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 transition-opacity"
        onClick={onClose}
      />

      {/* Cart Sidebar */}
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 flex flex-col animate-slide-in">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-6 flex justify-between items-center shadow-lg">
          <div>
            <h2 className="text-2xl font-bold">Your Cart</h2>
            <p className="text-blue-100 text-sm">
              {selectedItems.length} of {cart.length} {cart.length === 1 ? 'item' : 'items'} selected
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close cart"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-white hover:bg-white/20 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Cart Items */}
        <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <div className="w-32 h-32 bg-gray-200 rounded-full flex items-center justify-center mb-6">
                <svg className="w-16 h-16 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <p className="text-xl font-semibold text-gray-600 mb-2">Your cart is empty</p>
              <p className="text-sm text-gray-500">Add some products to get started</p>
            </div>
          ) : (
            <div className="space-y-4">
              <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl bg-white px-4 shadow-sm">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(event) => setSelected(event.target.checked ? sellable.map((item) => item.lineId) : [])}
                  className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-600"
                />
                <span className="text-sm font-semibold text-gray-700">Select all</span>
              </label>

              {cart.map((item) => (
                <div
                  key={item.lineId}
                  className={`flex gap-3 rounded-xl border bg-white p-4 shadow-sm transition-shadow hover:shadow-md ${
                    selected.includes(item.lineId) ? 'border-blue-300' : 'border-gray-100 opacity-70'
                  }`}
                >
                  {/* Tick the lines you want to pay for now */}
                  <input
                    type="checkbox"
                    checked={selected.includes(item.lineId) && !isSoldOut(item)}
                    onChange={() => toggleLine(item.lineId)}
                    disabled={isSoldOut(item)}
                    aria-label={`Check out ${item.name}`}
                    className="mt-1 h-5 w-5 flex-shrink-0 rounded border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
                  />

                  {/* Product Image */}
                  <div className="w-24 h-24 bg-gray-100 rounded-lg flex-shrink-0 overflow-hidden">
                    {item.image_url ? (
                      <img
                        src={item.image_url}
                        alt={item.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-400">
                        <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </div>
                    )}
                  </div>

                  {/* Product Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="font-bold text-gray-900 text-sm line-clamp-2 pr-2">
                        {item.name}
                      </h3>
                      <button
                        onClick={() => confirmRemove(item)}
                        aria-label={`Remove ${item.name} from cart`}
                        className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-red-500 hover:bg-red-50 flex-shrink-0 transition-colors"
                        title="Remove item"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                    
                    {describeSelection(item.selectedOptions) && (
                      <p className="mb-1 text-xs font-medium text-gray-500">
                        {describeSelection(item.selectedOptions)}
                      </p>
                    )}

                    {isSoldOut(item) && (
                      <p className="mb-1 inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">
                        Sold Out — remove it to check out
                      </p>
                    )}

                    <p className="text-blue-600 font-bold text-lg mb-3">
                      ₱{Number(item.price).toFixed(2)}
                    </p>

                    {/* Quantity Controls */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
                        {/* At one, the minus does nothing: removing an item is
                            the trash button's job, with its own confirmation. */}
                        <button
                          onClick={() => onUpdateQuantity(item.lineId, item.quantity - 1)}
                          disabled={item.quantity <= 1}
                          aria-label={`Decrease quantity of ${item.name}`}
                          title={item.quantity <= 1 ? 'Use the bin to remove this item' : 'One less'}
                          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md bg-white font-bold text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                          </svg>
                        </button>
                        <span className="w-8 text-center font-bold text-gray-900" aria-live="polite">{item.quantity}</span>
                        <button
                          onClick={() => onUpdateQuantity(item.lineId, item.quantity + 1)}
                          disabled={Number(item.quantity) >= Number(item.stock)}
                          aria-label={`Increase quantity of ${item.name}`}
                          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md bg-white font-bold text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                        </button>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-500">Subtotal</p>
                        <p className="font-bold text-gray-900">₱{(Number(item.price) * Number(item.quantity)).toFixed(2)}</p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {cart.length > 0 && (
          <div className="border-t bg-white p-6 shadow-lg">
            {/* Totals */}
            <div className="space-y-2 mb-4">
              <div className="flex justify-between text-gray-600">
                <span>Subtotal ({selectedItems.length} selected)</span>
                <span className="font-semibold">₱{selectedTotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm text-gray-500">
                <span>Estimated Delivery</span>
                <span>FREE</span>
              </div>
              <div className="border-t pt-2 flex justify-between items-center">
                <span className="text-lg font-bold text-gray-900">Total</span>
                <span className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-blue-700 bg-clip-text text-transparent">
                  ₱{selectedTotal.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Rewards Info */}
            <div className="bg-gradient-to-r from-yellow-50 to-yellow-100 border border-yellow-200 rounded-lg p-3 mb-4">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-yellow-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
                <p className="text-sm text-yellow-900">
                  <span className="font-bold">Earn {Math.floor(selectedTotal / 100) * 10} points</span> with this purchase
                </p>
              </div>
            </div>

            {/* Checkout Button */}
            <button
              onClick={() => {
                // Only the ticked lines go to checkout; the rest stay in the cart
                storeSelection(userId, selected);
                window.location.href = '/shop/checkout';
              }}
              disabled={selectedItems.length === 0}
              className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white py-4 rounded-xl font-bold text-lg hover:from-blue-700 hover:to-blue-800 transition-all shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 active:scale-95 flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:from-gray-300 disabled:to-gray-300 disabled:shadow-none disabled:transform-none"
            >
              <span>
                {selectedItems.length === 0
                  ? 'Select an item to check out'
                  : `Check Out ${selectedItems.length} ${selectedItems.length === 1 ? 'Item' : 'Items'}`}
              </span>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </button>
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes slide-in {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }
        .animate-slide-in {
          animation: slide-in 0.3s ease-out;
        }
      `}</style>
    </>
  );
}
