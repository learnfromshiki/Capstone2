'use client';

import { useEffect, useRef, useState } from 'react';
import { RETURN_DAYS, RETURN_REASONS } from '@/lib/returns';
import { uploadPhotos } from '@/lib/attachments';
import Img from '@/components/ui/Img';

const MAX_PHOTOS = 5;

/**
 * Ask for a return (delivered order) or a cancel & refund (paid online, not
 * shipped yet), with a reason and photos, like Shopee's Return/Refund.
 */
export default function ReturnRequestDialog({ order, orderNumber, onSubmit, onClose }) {
  const [reason, setReason] = useState('');
  const [other, setOther] = useState('');
  const [details, setDetails] = useState('');
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const isReturn = order?.status === 'delivered';

  useEffect(() => {
    setReason('');
    setOther('');
    setDetails('');
    setError('');
    setPhotos((current) => {
      current.forEach((photo) => URL.revokeObjectURL(photo.preview));
      return [];
    });
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

  const finalReason = reason === 'Other' ? other.trim() : reason;
  const reasons = isReturn ? RETURN_REASONS : ['Ordered by mistake', 'I want to change the items', 'Found a better price', 'It is taking too long', 'Other'];

  const addPhotos = (event) => {
    const chosen = Array.from(event.target.files || []).filter((file) => file.type.startsWith('image/'));
    event.target.value = '';
    setPhotos((current) => [
      ...current,
      ...chosen.slice(0, MAX_PHOTOS - current.length).map((file) => ({ file, preview: URL.createObjectURL(file) })),
    ]);
  };

  const submit = async () => {
    if (!finalReason) {
      setError('Please choose a reason.');
      return;
    }
    if (isReturn && reason === 'Item arrived damaged' && photos.length === 0) {
      setError('Please add a photo of the damage so the shop can check it.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const urls = photos.length > 0 ? await uploadPhotos(photos.map((photo) => photo.file), 'return', MAX_PHOTOS) : [];
      await onSubmit({ reason: finalReason, details: details.trim(), photos: urls });
    } catch (submitError) {
      setError(submitError.message || 'Could not send your request.');
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isReturn ? 'Request a return' : 'Request a cancel and refund'}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
      >
        <h2 className="text-lg font-bold text-gray-900">
          {isReturn ? 'Return / Refund' : 'Cancel & refund'} · {orderNumber}
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          {isReturn
            ? `You can ask for a return within ${RETURN_DAYS} days of delivery. The shop reviews it, then you get your money back once it is approved.`
            : 'This order was already paid online. Once the shop approves, it is cancelled and your payment is returned.'}
        </p>

        <fieldset className="mt-4 space-y-2">
          <legend className="mb-1 text-sm font-semibold text-gray-800">Reason</legend>
          {reasons.map((entry) => (
            <label
              key={entry}
              className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border px-3 text-sm ${
                reason === entry ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <input
                type="radio"
                name="return-reason"
                checked={reason === entry}
                onChange={() => setReason(entry)}
                className="h-4 w-4 text-blue-600"
              />
              {entry}
            </label>
          ))}
        </fieldset>
        {reason === 'Other' && (
          <input
            value={other}
            onChange={(event) => setOther(event.target.value.slice(0, 200))}
            placeholder="Your reason"
            className="mt-2 min-h-[44px] w-full rounded-lg border border-gray-300 px-3 text-sm"
          />
        )}

        <label className="mt-4 block text-sm font-semibold text-gray-800">
          Details <span className="font-normal text-gray-500">optional</span>
          <textarea
            value={details}
            onChange={(event) => setDetails(event.target.value.slice(0, 1000))}
            rows={3}
            placeholder="What happened? Anything the shop should know."
            className="mt-1 w-full rounded-lg border border-gray-300 p-3 text-sm font-normal"
          />
        </label>

        {isReturn && (
          <div className="mt-3">
            <p className="text-sm font-semibold text-gray-800">
              Photos <span className="font-normal text-gray-500">up to {MAX_PHOTOS}</span>
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {photos.map((photo, index) => (
                <div key={photo.preview} className="relative">
                  <Img src={photo.preview} alt="" width={128} className="h-16 w-16 rounded-lg object-cover" />
                  <button
                    type="button"
                    onClick={() =>
                      setPhotos((current) => {
                        URL.revokeObjectURL(current[index].preview);
                        return current.filter((_, position) => position !== index);
                      })
                    }
                    aria-label={`Remove photo ${index + 1}`}
                    className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-gray-800 text-xs text-white"
                  >
                    ×
                  </button>
                </div>
              ))}
              {photos.length < MAX_PHOTOS && (
                <>
                  <input ref={fileRef} type="file" accept="image/*" multiple onChange={addPhotos} className="hidden" />
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="flex h-16 w-16 items-center justify-center rounded-lg border-2 border-dashed border-gray-300 text-2xl text-gray-400 hover:border-blue-500 hover:text-blue-600"
                    aria-label="Add photos"
                  >
                    +
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {error && (
          <p className="mt-3 text-sm text-red-600" role="alert">
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
            Back
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !finalReason}
            className="min-h-[44px] flex-1 rounded-lg bg-blue-600 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {busy ? 'Sending…' : 'Send request'}
          </button>
        </div>
      </div>
    </div>
  );
}
