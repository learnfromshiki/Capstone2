'use client';

import { useState } from 'react';
import { supabase, clearStoredSession } from '@/lib/supabaseClient';
import { showSigningOut } from '@/lib/signOutScreen';

/**
 * A customer deletes their own account (delete_my_account()). Orders already
 * made stay for the shops' records, without the customer's personal details.
 */
export default function DeleteAccountCard() {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const remove = async () => {
    setBusy(true);
    setError('');
    const { error: rpcError } = await supabase.rpc('delete_my_account', { p_confirm: typed.trim() });
    if (rpcError) {
      setBusy(false);
      setError(
        /function .* does not exist|could not find the function/i.test(rpcError.message || '')
          ? 'Deleting accounts is not set up yet. Please contact CONNECT-Daet support.'
          : rpcError.message
      );
      return;
    }
    // The login no longer exists: clear this browser and leave.
    showSigningOut();
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch (signOutError) {
      // The session is already gone on the server.
    }
    clearStoredSession();
    window.location.replace('/shop');
  };

  return (
    <div className="rounded-lg border border-red-200 p-4">
      <h3 className="mb-1 font-semibold text-red-700">Delete my account</h3>
      <p className="text-sm text-gray-600">
        Permanently removes your account, profile, cart, likes on this account, follows, chats and reward points. Orders
        you already made stay with the shops for their records, but your name, email, phone and address are removed
        from them. This cannot be undone.
      </p>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 min-h-[44px] rounded-lg border-2 border-red-200 px-4 font-semibold text-red-600 hover:bg-red-50"
        >
          Delete my account…
        </button>
      ) : (
        <div className="mt-3 space-y-2">
          <label className="block text-sm font-medium text-gray-800">
            Type <span className="font-mono font-bold">DELETE</span> to confirm
            <input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              className="mt-1 min-h-[44px] w-full rounded-lg border border-gray-300 px-3 font-mono"
            />
          </label>
          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setTyped('');
                setError('');
              }}
              disabled={busy}
              className="min-h-[44px] flex-1 rounded-lg bg-gray-100 font-semibold text-gray-700 hover:bg-gray-200 disabled:opacity-50"
            >
              Keep my account
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={busy || typed.trim() !== 'DELETE'}
              className="min-h-[44px] flex-1 rounded-lg bg-red-600 font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {busy ? 'Deleting…' : 'Delete permanently'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
