'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

const COURIERS = ['J&T Express', 'LBC', 'Flash Express', 'Ninja Van', 'Lalamove', 'Grab Express', 'Own rider'];

/**
 * The shop adds the courier and tracking number for a delivery; the buyer sees
 * it on their order and gets a notification (set_order_tracking()).
 */
export default function TrackingForm({ order, onSaved }) {
  const [courier, setCourier] = useState(order.courier || '');
  const [number, setNumber] = useState(order.tracking_number || '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const unchanged = (courier || '') === (order.courier || '') && (number || '').trim() === (order.tracking_number || '');

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    const { error } = await supabase.rpc('set_order_tracking', {
      p_order_id: order.id,
      p_courier: courier || null,
      p_tracking_number: number.trim() || null,
    });
    setSaving(false);
    if (error) {
      setMessage({ type: 'error', text: /set_order_tracking/i.test(error.message || '') ? 'Tracking is not set up yet. Ask the admin to run supabase-shopee-features.sql.' : error.message });
      return;
    }
    setMessage({ type: 'success', text: number.trim() ? 'Saved. The customer was notified.' : 'Tracking removed.' });
    if (onSaved) onSaved({ courier: courier || null, tracking_number: number.trim() || null });
  };

  return (
    <form onSubmit={save} className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
      <p className="mb-2 text-sm font-semibold text-gray-800">🚚 Courier &amp; tracking number</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <select
          value={courier}
          onChange={(event) => setCourier(event.target.value)}
          aria-label="Courier"
          className="min-h-[40px] rounded-lg border border-gray-300 bg-white px-2 text-sm"
        >
          <option value="">Courier…</option>
          {COURIERS.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <input
          value={number}
          onChange={(event) => setNumber(event.target.value.slice(0, 80))}
          placeholder="Tracking number"
          aria-label="Tracking number"
          className="min-h-[40px] flex-1 rounded-lg border border-gray-300 px-3 font-mono text-sm"
        />
        <button
          type="submit"
          disabled={saving || unchanged}
          className="min-h-[40px] rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      {message && (
        <p className={`mt-2 text-xs ${message.type === 'error' ? 'text-red-600' : 'text-green-700'}`} role="status">
          {message.text}
        </p>
      )}
    </form>
  );
}
