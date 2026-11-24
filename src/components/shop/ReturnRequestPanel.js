'use client';

import { useState } from 'react';
import { RETURN_STATUS, markOrderRefunded, respondReturn } from '@/lib/returns';
import Img from '@/components/ui/Img';

/**
 * A return / refund request on an order card. The customer sees where it
 * stands; the shop and the admin can approve, decline and confirm the refund.
 *
 * role: 'buyer' | 'seller' | 'admin'
 */
export default function ReturnRequestPanel({ request, order, role, onChanged }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  if (!request) return null;

  const status = RETURN_STATUS[request.status] || RETURN_STATUS.requested;
  const isOnline = order?.payment_method === 'xendit';
  const canAnswer = role !== 'buyer' && request.status === 'requested';
  // Online payments go back through the platform's Xendit account, so only
  // the admin confirms those.
  const canMarkRefunded =
    request.status === 'approved' && (role === 'admin' || (role === 'seller' && !isOnline));

  const run = async (label, action) => {
    setBusy(label);
    setError('');
    try {
      await action();
      setNote('');
      if (onChanged) await onChanged();
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className={`mt-3 rounded-lg border p-3 text-sm ${status.tone}`}>
      <p className="font-semibold">
        {request.kind === 'return' ? 'Return / refund request' : 'Cancel & refund request'} · {status.label}
      </p>
      <p className="mt-1">
        <span className="font-medium">Reason:</span> {request.reason}
      </p>
      {request.details && <p className="mt-1 whitespace-pre-line">{request.details}</p>}
      {Array.isArray(request.photos) && request.photos.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {request.photos.map((url) => (
            <a key={url} href={url} target="_blank" rel="noopener noreferrer">
              <Img src={url} alt="Photo from the customer" width={128} className="h-14 w-14 rounded-lg border border-white object-cover" />
            </a>
          ))}
        </div>
      )}
      {role === 'buyer' && request.status === 'declined' && (
        <p className="mt-2">
          {request.kind === 'return'
            ? 'The shop declined your return request, so no refund will be made for this order.'
            : 'The shop declined your request to cancel and refund this order, so the order goes ahead and no refund will be made.'}{' '}
          Message the shop if you have questions.
        </p>
      )}
      {request.response_note && (
        <p className="mt-2">
          <span className="font-medium">{role === 'buyer' ? "Shop's reason" : 'Your note'}:</span> {request.response_note}
        </p>
      )}
      {role === 'buyer' && request.status === 'approved' && (
        <p className="mt-2 text-xs">
          {request.kind === 'return'
            ? 'Message the shop to arrange sending the item back. You will be notified when the refund is sent.'
            : 'You will be notified when your money has been sent back.'}
        </p>
      )}

      {canAnswer && (
        <div className="mt-3 space-y-2">
          <input
            value={note}
            onChange={(event) => setNote(event.target.value.slice(0, 500))}
            placeholder="Note to the customer (required to decline)"
            className="min-h-[40px] w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => run('approve', () => respondReturn(request.id, true, note))}
              className="min-h-[40px] rounded-lg bg-green-600 px-4 font-semibold text-white hover:bg-green-700 disabled:opacity-50"
            >
              {busy === 'approve' ? 'Approving…' : 'Approve'}
            </button>
            <button
              type="button"
              disabled={Boolean(busy) || !note.trim()}
              onClick={() => run('decline', () => respondReturn(request.id, false, note))}
              className="min-h-[40px] rounded-lg border border-red-300 bg-white px-4 font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              {busy === 'decline' ? 'Declining…' : 'Decline'}
            </button>
          </div>
          {request.kind === 'cancel_refund' && (
            <p className="text-xs">Approving cancels the order: stock and reward points go back automatically.</p>
          )}
        </div>
      )}

      {canMarkRefunded && (
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => run('refund', () => markOrderRefunded(order.id, null))}
          className="mt-3 min-h-[40px] rounded-lg bg-blue-600 px-4 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy === 'refund' ? 'Saving…' : 'I sent the refund — mark as refunded'}
        </button>
      )}
      {request.status === 'approved' && role === 'seller' && isOnline && (
        <p className="mt-2 text-xs">This was paid online, so the CONNECT-Daet admin sends the refund.</p>
      )}

      {error && (
        <p className="mt-2 text-xs text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
