'use client';

import { useState } from 'react';

/**
 * The receipt a customer uploaded for a GCash or bank transfer, as the shop
 * and the admin see it on the order. Tapping it opens the full picture, which
 * is how you actually read a reference number off a screenshot.
 */
export default function PaymentProof({ url, reference, paidAt, className = '' }) {
  const [zoomed, setZoomed] = useState(false);

  if (!url) return null;

  return (
    <div className={`rounded-xl border-2 border-green-100 bg-green-50 p-3 ${className}`}>
      <div className="flex items-start gap-3">
        <button type="button" onClick={() => setZoomed(true)} title="Tap to enlarge">
          <img
            src={url}
            alt="Payment receipt"
            className="h-20 w-20 rounded-lg border border-green-200 object-cover"
          />
        </button>

        <div className="min-w-0 text-sm">
          <p className="font-semibold text-green-800">Payment receipt attached</p>
          {reference && (
            <p className="text-gray-700">
              Reference: <span className="font-mono font-semibold">{reference}</span>
            </p>
          )}
          {paidAt && (
            <p className="text-xs text-gray-500">
              Uploaded {new Date(paidAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
          )}
          <p className="mt-1 text-xs text-gray-500">Check it against your account before you ship.</p>
        </div>
      </div>

      {zoomed && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setZoomed(false)}
          role="presentation"
        >
          <img
            src={url}
            alt="Payment receipt"
            className="max-h-[85vh] max-w-full rounded-xl bg-white p-2"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
