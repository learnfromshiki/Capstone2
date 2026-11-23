'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

const REASONS = {
  product: [
    'Fake or counterfeit item',
    'Prohibited or dangerous item',
    'Misleading photos, price or description',
    'Offensive content',
    'Scam or suspicious listing',
    'Other',
  ],
  shop: [
    'Scam or fraud',
    'Did not deliver after payment',
    'Rude or abusive messages',
    'Selling prohibited items',
    'Pretending to be another shop',
    'Other',
  ],
};

/**
 * Report a product or a shop to the CONNECT-Daet admin (shop_reports).
 * target: { type: 'product' | 'shop', productId?, sellerId?, name }
 */
export default function ReportDialog({ target, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [other, setOther] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setReason('');
    setOther('');
    setDetails('');
    setError('');
  }, [target?.type, target?.productId, target?.sellerId]);

  useEffect(() => {
    if (!target) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target, busy, onClose]);

  if (!target) return null;

  const finalReason = reason === 'Other' ? other.trim() : reason;

  const submit = async () => {
    setBusy(true);
    setError('');
    const { error: insertError } = await supabase.from('shop_reports').insert({
      target_type: target.type,
      product_id: target.type === 'product' ? target.productId : null,
      seller_id: target.type === 'shop' ? target.sellerId : null,
      reason: finalReason.slice(0, 200),
      details: details.trim().slice(0, 1000) || null,
    });
    setBusy(false);
    if (insertError) {
      setError(
        /duplicate|unique/i.test(insertError.message || '')
          ? 'You already reported this. The admin is looking into it.'
          : /relation .* does not exist|schema cache/i.test(insertError.message || '')
            ? 'Reporting is not set up yet. Please message CONNECT-Daet support.'
            : insertError.message
      );
      return;
    }
    onDone();
  };

  return (
    <div className="modal-backdrop fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Report ${target.name}`}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
      >
        <h2 className="text-lg font-bold text-gray-900">
          Report {target.type === 'shop' ? 'shop' : 'product'}: {target.name}
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          The CONNECT-Daet admin reviews every report. The {target.type === 'shop' ? 'shop' : 'seller'} is not told who
          reported.
        </p>

        <fieldset className="mt-4 space-y-2">
          <legend className="sr-only">Reason</legend>
          {REASONS[target.type].map((entry) => (
            <label
              key={entry}
              className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border px-3 text-sm ${
                reason === entry ? 'border-red-400 bg-red-50' : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <input
                type="radio"
                name="report-reason"
                checked={reason === entry}
                onChange={() => setReason(entry)}
                className="h-4 w-4 text-red-600"
              />
              {entry}
            </label>
          ))}
        </fieldset>
        {reason === 'Other' && (
          <input
            value={other}
            onChange={(event) => setOther(event.target.value.slice(0, 200))}
            placeholder="What is the problem?"
            className="mt-2 min-h-[44px] w-full rounded-lg border border-gray-300 px-3 text-sm"
          />
        )}
        <textarea
          value={details}
          onChange={(event) => setDetails(event.target.value.slice(0, 1000))}
          rows={3}
          placeholder="Details that help the admin check (optional)"
          className="mt-3 w-full rounded-lg border border-gray-300 p-3 text-sm"
        />

        {error && (
          <p className="mt-2 text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-[44px] flex-1 rounded-lg bg-gray-100 font-semibold text-gray-700 hover:bg-gray-200 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !finalReason}
            className="min-h-[44px] flex-1 rounded-lg bg-red-600 font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {busy ? 'Sending…' : 'Send report'}
          </button>
        </div>
      </div>
    </div>
  );
}
