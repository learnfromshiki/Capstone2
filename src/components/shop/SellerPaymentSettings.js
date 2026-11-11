'use client';

import { useEffect, useRef, useState } from 'react';
import { uploadAttachment } from '@/lib/attachments';
import { useDialog } from '@/components/ui/Dialog';
import { readPaymentDetails, savePaymentDetails } from '@/lib/sellerPayments';

/**
 * Where a shop says how it wants to be paid.
 *
 * A customer who picks GCash or Bank Transfer at checkout is shown exactly
 * what is saved here — the number, the account name and the QR code — and has
 * to attach a photo of their receipt before the order goes through. A method
 * left blank is simply not offered to them, so nobody can pay into an account
 * that does not exist.
 */
/** One QR code slot: the picture, and the buttons that change it. */
function QrField({ label, value, busy, fileRef, onChoose, onClear }) {
  return (
    <div>
      <label className="mb-2 block text-sm font-semibold text-gray-700">{label}</label>
      <div className="flex items-center gap-4">
        {value ? (
          <img src={value} alt={label} className="h-24 w-24 rounded-xl border border-gray-200 object-cover" />
        ) : (
          <div className="flex h-24 w-24 items-center justify-center rounded-xl border-2 border-dashed border-gray-300 text-xs text-gray-400">
            No QR yet
          </div>
        )}

        <div className="space-y-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              onChoose(file);
            }}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="min-h-[44px] rounded-lg border-2 border-blue-200 px-4 text-sm font-semibold text-blue-600 transition-colors hover:bg-blue-50 disabled:opacity-50"
          >
            {busy ? 'Uploading...' : value ? 'Replace QR code' : 'Upload QR code'}
          </button>
          {value && (
            <button
              type="button"
              onClick={onClear}
              className="block text-xs font-semibold text-red-600 hover:underline"
            >
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SellerPaymentSettings({ seller, onSaved }) {
  const [form, setForm] = useState(() => readPaymentDetails(seller));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState('');
  const [feedback, setFeedback] = useState({ type: '', text: '' });
  const gcashFileRef = useRef(null);
  const bankFileRef = useRef(null);
  const { showAlert } = useDialog();

  useEffect(() => {
    setForm(readPaymentDetails(seller));
  }, [seller?.id, seller?.gcash_number, seller?.bank_account_number]);

  const inputClass =
    'w-full min-h-[44px] px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500';

  const uploadQr = async (field, file) => {
    if (!file) return;

    setUploading(field);
    try {
      const { url } = await uploadAttachment(file, 'qr', { allowVideo: false });
      setForm((current) => ({ ...current, [field]: url }));
      setFeedback({ type: 'success', text: 'QR code uploaded. Remember to save.' });
    } catch (error) {
      showAlert(error.message || 'Could not upload that QR code.');
    } finally {
      setUploading('');
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setFeedback({ type: '', text: '' });

    try {
      const saved = await savePaymentDetails(seller.id, form);
      setFeedback({ type: 'success', text: 'Payment details saved. Customers will see them at checkout.' });
      if (onSaved) onSaved(saved);
    } catch (error) {
      setFeedback({ type: 'error', text: error.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-bold text-gray-900">Payment Details</h3>
      <p className="mt-1 text-sm text-gray-600">
        Customers who choose GCash or Bank Transfer see this, pay you directly, then attach a photo of their
        receipt. Leave a section blank and that method is not offered for your shop.
      </p>

      <div className="mt-6 grid gap-8 lg:grid-cols-2">
        {/* GCash */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-sm">📱</span>
            <h4 className="font-bold text-gray-900">GCash</h4>
          </div>

          <div>
            <label htmlFor="gcash-name" className="mb-2 block text-sm font-semibold text-gray-700">
              Account name
            </label>
            <input
              id="gcash-name"
              type="text"
              value={form.gcash_name}
              onChange={(event) => setForm({ ...form, gcash_name: event.target.value })}
              placeholder="Juan D."
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="gcash-number" className="mb-2 block text-sm font-semibold text-gray-700">
              GCash number
            </label>
            <input
              id="gcash-number"
              type="tel"
              value={form.gcash_number}
              onChange={(event) => setForm({ ...form, gcash_number: event.target.value })}
              placeholder="09XX XXX XXXX"
              className={inputClass}
            />
          </div>

          <QrField
            label="GCash QR code"
            value={form.gcash_qr_url}
            busy={uploading === 'gcash_qr_url'}
            fileRef={gcashFileRef}
            onChoose={(file) => uploadQr('gcash_qr_url', file)}
            onClear={() => setForm((current) => ({ ...current, gcash_qr_url: '' }))}
          />
        </div>

        {/* Bank transfer */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 text-sm">🏦</span>
            <h4 className="font-bold text-gray-900">Bank Transfer</h4>
          </div>

          <div>
            <label htmlFor="bank-name" className="mb-2 block text-sm font-semibold text-gray-700">
              Bank
            </label>
            <input
              id="bank-name"
              type="text"
              value={form.bank_name}
              onChange={(event) => setForm({ ...form, bank_name: event.target.value })}
              placeholder="BDO, BPI, Landbank..."
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="bank-account-name" className="mb-2 block text-sm font-semibold text-gray-700">
              Account name
            </label>
            <input
              id="bank-account-name"
              type="text"
              value={form.bank_account_name}
              onChange={(event) => setForm({ ...form, bank_account_name: event.target.value })}
              placeholder="Juan Dela Cruz"
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="bank-account-number" className="mb-2 block text-sm font-semibold text-gray-700">
              Account number
            </label>
            <input
              id="bank-account-number"
              type="text"
              value={form.bank_account_number}
              onChange={(event) => setForm({ ...form, bank_account_number: event.target.value })}
              placeholder="0000 0000 0000"
              className={inputClass}
            />
          </div>

          <QrField
            label="Bank QR code (optional)"
            value={form.bank_qr_url}
            busy={uploading === 'bank_qr_url'}
            fileRef={bankFileRef}
            onChoose={(file) => uploadQr('bank_qr_url', file)}
            onClear={() => setForm((current) => ({ ...current, bank_qr_url: '' }))}
          />
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || Boolean(uploading)}
          className="min-h-[44px] rounded-xl bg-blue-600 px-6 font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Payment Details'}
        </button>

        {feedback.text && (
          <p
            role="status"
            className={`text-sm font-medium ${feedback.type === 'error' ? 'text-red-600' : 'text-green-600'}`}
          >
            {feedback.text}
          </p>
        )}
      </div>
    </div>
  );
}
