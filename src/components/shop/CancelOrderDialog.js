'use client';

import { useEffect, useState } from 'react';

export const CANCEL_REASONS = [
  'I want to change the delivery address',
  'I want to change the items or quantity',
  'I found a better price elsewhere',
  'I ordered by mistake',
  'It is taking too long',
  'Other',
];

/**
 * Ask why an order is being cancelled (like Shopee), then confirm. The reason
 * is saved on the order and shown to the shop.
 */
export default function CancelOrderDialog({ order, orderNumber, busy = false, onConfirm, onClose }) {
  const [choice, setChoice] = useState('');
  const [other, setOther] = useState('');

  useEffect(() => {
    setChoice('');
    setOther('');
  }, [order?.id]);

  useEffect(() => {
    if (!order) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [order, busy, onClose]);

  if (!order) return null;

  const reason = choice === 'Other' ? other.trim() : choice;
  const ready = Boolean(reason);

  return (
    <div className="modal-backdrop fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
      <div role="dialog" aria-modal="true" aria-label={`Cancel order ${orderNumber}`} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <h2 className="text-lg font-bold text-gray-900">Cancel order {orderNumber}?</h2>
        <p className="mt-1 text-sm text-gray-600">
          Tell the shop why. The items go back on sale, and any reward points or voucher you used are handled
          automatically.
        </p>

        <fieldset className="mt-4 space-y-2">
          <legend className="sr-only">Reason for cancelling</legend>
          {CANCEL_REASONS.map((entry) => (
            <label
              key={entry}
              className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border px-3 text-sm transition-colors ${
                choice === entry ? 'border-red-400 bg-red-50' : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <input
                type="radio"
                name="cancel-reason"
                value={entry}
                checked={choice === entry}
                onChange={() => setChoice(entry)}
                className="h-4 w-4 text-red-600"
              />
              {entry}
            </label>
          ))}
        </fieldset>

        {choice === 'Other' && (
          <textarea
            value={other}
            onChange={(event) => setOther(event.target.value)}
            maxLength={300}
            rows={2}
            placeholder="Please tell us more"
            className="mt-2 w-full rounded-lg border border-gray-300 p-3 text-sm focus:border-red-400 focus:ring-2 focus:ring-red-200"
          />
        )}

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-[44px] flex-1 rounded-lg bg-gray-100 font-semibold text-gray-700 hover:bg-gray-200 disabled:opacity-50"
          >
            Keep my order
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason)}
            disabled={!ready || busy}
            className="min-h-[44px] flex-1 rounded-lg bg-red-600 font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {busy ? 'Cancelling...' : 'Cancel order'}
          </button>
        </div>
      </div>
    </div>
  );
}
