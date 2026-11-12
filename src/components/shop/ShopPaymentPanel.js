'use client';

import { useRef, useState } from 'react';
import { uploadAttachment } from '@/lib/attachments';
import { useDialog } from '@/components/ui/Dialog';

/**
 * Paying each shop, at checkout.
 *
 * Every shop in the basket is paid separately, because every shop has its own
 * GCash number and bank account, so this shows one panel per shop: what to
 * send, where to send it, and the receipt the customer attaches afterwards.
 * The order cannot be placed until every shop has a receipt.
 */
export default function ShopPaymentPanel({ method, groups, receipts, onChange }) {
  const [uploading, setUploading] = useState('');
  const [zoomed, setZoomed] = useState('');
  const fileRefs = useRef({});
  const { showAlert } = useDialog();

  const isGcash = method === 'gcash';

  const handleFile = async (sellerKey, file) => {
    if (!file) return;

    setUploading(sellerKey);
    try {
      const { url } = await uploadAttachment(file, 'receipt', { allowVideo: false });
      onChange(sellerKey, { ...(receipts[sellerKey] || {}), url });
    } catch (error) {
      showAlert(error.message || 'Could not upload that receipt.');
    } finally {
      setUploading('');
    }
  };

  return (
    <div className="space-y-4">
      {groups.map((group) => {
        const details = group.payment || {};
        const receipt = receipts[group.key] || {};
        const accountName = isGcash ? details.gcash_name : details.bank_account_name;
        const accountNumber = isGcash ? details.gcash_number : details.bank_account_number;
        const qr = isGcash ? details.gcash_qr_url : details.bank_qr_url;

        return (
          <div key={group.key} className="rounded-xl border-2 border-blue-100 bg-blue-50/50 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-bold text-gray-900">{group.name}</p>
              <p className="text-lg font-bold text-blue-700">₱{group.amount.toFixed(2)}</p>
            </div>

            <div className="mt-3 flex flex-col items-start gap-4 sm:flex-row sm:flex-wrap">
              {qr && (
                <button
                  type="button"
                  onClick={() => setZoomed(qr)}
                  title="Tap to enlarge"
                  className="rounded-xl border border-gray-200 bg-white p-1"
                >
                  <img src={qr} alt={`${group.name} ${isGcash ? 'GCash' : 'bank'} QR code`} className="h-32 w-32 object-contain" />
                </button>
              )}

              <div className="min-w-[12rem] flex-1 space-y-1 text-sm">
                {!isGcash && details.bank_name && (
                  <p>
                    <span className="text-gray-500">Bank: </span>
                    <span className="font-semibold text-gray-900">{details.bank_name}</span>
                  </p>
                )}
                {accountName && (
                  <p>
                    <span className="text-gray-500">Account name: </span>
                    <span className="font-semibold text-gray-900">{accountName}</span>
                  </p>
                )}
                {accountNumber && (
                  <p>
                    <span className="text-gray-500">{isGcash ? 'GCash number: ' : 'Account number: '}</span>
                    <span className="font-mono font-bold text-gray-900">{accountNumber}</span>
                  </p>
                )}
                {qr && <p className="text-xs text-gray-500">Scan the QR code, or send to the number above.</p>}
              </div>
            </div>

            {/* The receipt */}
            <div className="mt-4 border-t border-blue-100 pt-3">
              <p className="text-sm font-semibold text-gray-900">
                Upload your payment receipt <span className="text-red-600">*</span>
              </p>
              <p className="mt-0.5 text-xs text-gray-600">
                A screenshot of the {isGcash ? 'GCash' : 'transfer'} confirmation, so {group.name} can check your payment.
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-3">
                {receipt.url ? (
                  <img
                    src={receipt.url}
                    alt="Your payment receipt"
                    className="h-20 w-20 rounded-lg border border-gray-200 object-cover"
                  />
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded-lg border-2 border-dashed border-gray-300 text-center text-[10px] text-gray-400">
                    No receipt yet
                  </div>
                )}

                <div className="space-y-2">
                  <input
                    ref={(node) => {
                      fileRefs.current[group.key] = node;
                    }}
                    type="file"
                    accept="image/*"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      handleFile(group.key, file);
                    }}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileRefs.current[group.key]?.click()}
                    disabled={uploading === group.key}
                    className="min-h-[44px] rounded-lg bg-white px-4 text-sm font-semibold text-blue-600 shadow-sm ring-2 ring-blue-200 transition-colors hover:bg-blue-50 disabled:opacity-50"
                  >
                    {uploading === group.key
                      ? 'Uploading...'
                      : receipt.url
                      ? 'Replace receipt'
                      : 'Choose receipt photo'}
                  </button>

                  <input
                    type="text"
                    value={receipt.reference || ''}
                    onChange={(event) =>
                      onChange(group.key, { ...receipt, reference: event.target.value.slice(0, 60) })
                    }
                    placeholder="Reference number (optional)"
                    aria-label={`Reference number for ${group.name}`}
                    className="min-h-[44px] w-full max-w-[14rem] rounded-lg border-2 border-gray-200 px-3 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {/* The QR code, large enough to scan from another phone */}
      {zoomed && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setZoomed('')}
          role="presentation"
        >
          <img
            src={zoomed}
            alt="QR code"
            className="max-h-[80vh] max-w-full rounded-xl bg-white p-3"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
