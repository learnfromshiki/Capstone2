'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useDialog } from '@/components/ui/Dialog';
import { describeVoucher } from '@/lib/shopFeatures';

const EMPTY = {
  code: '',
  kind: 'fixed',
  amount: '',
  min_spend: '',
  max_discount: '',
  ends_at: '',
  usage_limit: '',
};

const inputClass =
  'w-full min-h-[44px] rounded-xl border-2 border-gray-200 px-3 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500';

/**
 * Shop vouchers (like Shopee's): the shop creates codes buyers enter at
 * checkout. place_order() checks and applies them; the discount comes off this
 * shop's items only.
 */
export default function SellerVouchers({ seller }) {
  const { showAlert, showConfirm, showToast } = useDialog();
  const [vouchers, setVouchers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    if (!seller?.id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('shop_vouchers')
      .select('*')
      .eq('seller_id', seller.id)
      .order('created_at', { ascending: false });
    setLoading(false);
    if (error) {
      if (/relation .* does not exist|schema cache/i.test(error.message || '')) setMissing(true);
      else showAlert(error.message);
      return;
    }
    setVouchers(data || []);
  }, [seller?.id, showAlert]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (event) => {
    event.preventDefault();
    const code = form.code.trim().toUpperCase();
    const amount = Number(form.amount);
    const minSpend = form.min_spend === '' ? 0 : Number(form.min_spend);
    const maxDiscount = form.max_discount === '' ? null : Number(form.max_discount);
    const usageLimit = form.usage_limit === '' ? null : Number(form.usage_limit);

    if (!/^[A-Z0-9]{3,20}$/.test(code)) {
      showAlert('Use 3 to 20 letters and numbers for the code, for example SAVE50.');
      return;
    }
    if (!(amount > 0) || (form.kind === 'percent' && amount > 90)) {
      showAlert(form.kind === 'percent' ? 'Enter a percentage from 1 to 90.' : 'Enter how many pesos the voucher takes off.');
      return;
    }
    if (form.kind === 'fixed' && minSpend > 0 && amount >= minSpend) {
      showAlert('A peso voucher should be smaller than its minimum spend, or the order would be almost free.');
      return;
    }
    if (usageLimit !== null && !(Number.isInteger(usageLimit) && usageLimit > 0)) {
      showAlert('The usage limit must be a whole number, or leave it empty for no limit.');
      return;
    }

    setSaving(true);
    const { error } = await supabase.from('shop_vouchers').insert({
      seller_id: seller.id,
      code,
      kind: form.kind,
      amount,
      min_spend: minSpend,
      max_discount: form.kind === 'percent' ? maxDiscount : null,
      ends_at: form.ends_at ? new Date(`${form.ends_at}T23:59:59`).toISOString() : null,
      usage_limit: usageLimit,
    });
    setSaving(false);

    if (error) {
      showAlert(/duplicate key/i.test(error.message || '') ? `You already have a voucher called ${code}.` : error.message);
      return;
    }
    setForm(EMPTY);
    showToast(`Voucher ${code} is live.`, 'success');
    load();
  };

  const toggle = async (voucher) => {
    const { error } = await supabase
      .from('shop_vouchers')
      .update({ is_active: !voucher.is_active })
      .eq('id', voucher.id);
    if (error) {
      showAlert(error.message);
      return;
    }
    load();
  };

  const remove = async (voucher) => {
    const confirmed = await showConfirm({
      tone: 'warning',
      title: `Delete voucher ${voucher.code}?`,
      message: 'Buyers can no longer use it. Orders that already used it keep their discount.',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep it',
    });
    if (!confirmed) return;
    const { error } = await supabase.from('shop_vouchers').delete().eq('id', voucher.id);
    if (error) {
      showAlert(error.message);
      return;
    }
    load();
  };

  if (missing) {
    return (
      <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-6 text-sm text-yellow-900">
        Vouchers are not set up yet. Ask the admin to run <code>supabase-shopee-features.sql</code> in Supabase.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Shop Vouchers</h2>
        <p className="text-sm text-gray-600">
          Codes buyers enter at checkout. They show on your shop page and on your products. The discount comes off your
          items only, not the delivery fee.
        </p>
      </div>

      <form onSubmit={create} className="space-y-4 rounded-xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6">
        <h3 className="font-bold text-gray-900">New voucher</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-semibold text-gray-700">
            Code
            <input
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20) })}
              placeholder="SAVE50"
              className={`${inputClass} mt-1 font-mono`}
              required
            />
          </label>
          <label className="text-sm font-semibold text-gray-700">
            Type
            <select
              value={form.kind}
              onChange={(event) => setForm({ ...form, kind: event.target.value })}
              className={`${inputClass} mt-1 bg-white`}
            >
              <option value="fixed">₱ off</option>
              <option value="percent">% off</option>
            </select>
          </label>
          <label className="text-sm font-semibold text-gray-700">
            {form.kind === 'percent' ? 'Percent off (1–90)' : 'Pesos off'}
            <input
              type="number"
              min="1"
              step="0.01"
              value={form.amount}
              onChange={(event) => setForm({ ...form, amount: event.target.value })}
              className={`${inputClass} mt-1`}
              required
            />
          </label>
          <label className="text-sm font-semibold text-gray-700">
            Minimum spend (₱) <span className="font-normal text-gray-500">optional</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.min_spend}
              onChange={(event) => setForm({ ...form, min_spend: event.target.value })}
              className={`${inputClass} mt-1`}
            />
          </label>
          {form.kind === 'percent' && (
            <label className="text-sm font-semibold text-gray-700">
              Maximum discount (₱) <span className="font-normal text-gray-500">optional</span>
              <input
                type="number"
                min="1"
                step="0.01"
                value={form.max_discount}
                onChange={(event) => setForm({ ...form, max_discount: event.target.value })}
                className={`${inputClass} mt-1`}
              />
            </label>
          )}
          <label className="text-sm font-semibold text-gray-700">
            Valid until <span className="font-normal text-gray-500">optional</span>
            <input
              type="date"
              value={form.ends_at}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(event) => setForm({ ...form, ends_at: event.target.value })}
              className={`${inputClass} mt-1`}
            />
          </label>
          <label className="text-sm font-semibold text-gray-700">
            Usage limit <span className="font-normal text-gray-500">optional, total uses</span>
            <input
              type="number"
              min="1"
              step="1"
              value={form.usage_limit}
              onChange={(event) => setForm({ ...form, usage_limit: event.target.value })}
              className={`${inputClass} mt-1`}
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="min-h-[44px] rounded-xl bg-blue-600 px-6 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Creating…' : 'Create voucher'}
        </button>
      </form>

      <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6">
        <h3 className="mb-3 font-bold text-gray-900">Your vouchers</h3>
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : vouchers.length === 0 ? (
          <p className="text-sm text-gray-500">No vouchers yet. Create one above to attract buyers.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {vouchers.map((voucher) => {
              const text = describeVoucher(voucher);
              const expired = voucher.ends_at && new Date(voucher.ends_at) < new Date();
              const usedUp = voucher.usage_limit && voucher.used_count >= voucher.usage_limit;
              const state = !voucher.is_active ? 'Paused' : expired ? 'Expired' : usedUp ? 'Used up' : 'Live';
              return (
                <li key={voucher.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-red-600 px-2 py-0.5 font-mono text-sm font-bold text-white">{voucher.code}</span>
                      <span className="font-semibold text-gray-900">{text.headline}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          state === 'Live' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {state}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      {text.minimum}
                      {text.until && ` · ${text.until}`} · Used {voucher.used_count}
                      {voucher.usage_limit ? ` of ${voucher.usage_limit}` : ''} times
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => toggle(voucher)}
                      className="min-h-[40px] rounded-lg border border-gray-200 px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                    >
                      {voucher.is_active ? 'Pause' : 'Resume'}
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(voucher)}
                      className="min-h-[40px] rounded-lg border border-red-200 px-3 text-sm font-semibold text-red-600 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
