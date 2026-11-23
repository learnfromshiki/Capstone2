'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useDialog } from '@/components/ui/Dialog';

const STATUS_STYLE = {
  open: 'bg-red-100 text-red-700',
  resolved: 'bg-green-100 text-green-700',
  dismissed: 'bg-gray-100 text-gray-600',
};

/**
 * Admin: reports from shoppers about products and shops. The admin checks,
 * can hide a reported product straight away, and closes the report with a note.
 */
export default function AdminReports({ onOpenSellers }) {
  const { showAlert, showConfirm, showToast } = useDialog();
  const [reports, setReports] = useState([]);
  const [names, setNames] = useState({ products: {}, shops: {}, people: {} });
  const [filter, setFilter] = useState('open');
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState({});
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('shop_reports').select('*').order('created_at', { ascending: false }).limit(300);
    if (error) {
      setLoading(false);
      showAlert(
        /relation .* does not exist|schema cache/i.test(error.message || '')
          ? 'Reports are not set up yet. Run supabase-pages-emails-reports.sql in Supabase.'
          : error.message
      );
      return;
    }
    const rows = data || [];
    const productIds = [...new Set(rows.map((row) => row.product_id).filter(Boolean))];
    const sellerIds = [...new Set(rows.map((row) => row.seller_id).filter(Boolean))];
    const peopleIds = [...new Set(rows.map((row) => row.reporter_id).filter(Boolean))];
    const [products, shops, people] = await Promise.all([
      productIds.length ? supabase.from('shop_products').select('id, name, available, seller_id').in('id', productIds) : { data: [] },
      sellerIds.length ? supabase.from('shop_sellers').select('id, business_name').in('id', sellerIds) : { data: [] },
      peopleIds.length ? supabase.from('profiles').select('id, full_name, email').in('id', peopleIds) : { data: [] },
    ]);
    setNames({
      products: Object.fromEntries((products.data || []).map((row) => [row.id, row])),
      shops: Object.fromEntries((shops.data || []).map((row) => [row.id, row])),
      people: Object.fromEntries((people.data || []).map((row) => [row.id, row])),
    });
    setReports(rows);
    setLoading(false);
  }, [showAlert]);

  useEffect(() => {
    load();
  }, [load]);

  const close = async (report, status) => {
    setBusyId(report.id);
    const { error } = await supabase
      .from('shop_reports')
      .update({ status, admin_note: (notes[report.id] || '').trim() || null, resolved_at: new Date().toISOString() })
      .eq('id', report.id);
    setBusyId(null);
    if (error) {
      showAlert(error.message);
      return;
    }
    showToast(status === 'resolved' ? 'Report resolved.' : 'Report dismissed.', 'success');
    load();
  };

  const hideProduct = async (report) => {
    const product = names.products[report.product_id];
    const confirmed = await showConfirm({
      tone: 'warning',
      title: `Hide "${product?.name || 'this product'}" from the shop?`,
      message: 'Shoppers can no longer see or buy it. The seller can see it is hidden in their dashboard.',
      confirmLabel: 'Hide product',
      cancelLabel: 'Cancel',
    });
    if (!confirmed) return;
    setBusyId(report.id);
    const { error } = await supabase
      .from('shop_products')
      .update({ available: false, updated_at: new Date().toISOString() })
      .eq('id', report.product_id);
    setBusyId(null);
    if (error) {
      showAlert(error.message);
      return;
    }
    showToast('Product hidden from the shop.', 'success');
    load();
  };

  const shown = reports.filter((report) => (filter === 'all' ? true : report.status === filter));
  const openCount = reports.filter((report) => report.status === 'open').length;

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-xl font-bold">Reports</h3>
          <p className="text-sm text-gray-600">Products and shops reported by shoppers. {openCount} waiting.</p>
        </div>
        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          aria-label="Filter reports"
          className="min-h-[44px] rounded-lg border-2 px-3"
        >
          <option value="open">Open ({openCount})</option>
          <option value="resolved">Resolved</option>
          <option value="dismissed">Dismissed</option>
          <option value="all">All ({reports.length})</option>
        </select>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading reports…</p>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-gray-100 bg-white p-10 text-center text-gray-500">
          {filter === 'open' ? 'No open reports. All clear.' : 'Nothing here.'}
        </div>
      ) : (
        <ul className="space-y-3">
          {shown.map((report) => {
            const product = names.products[report.product_id];
            const shop = names.shops[report.seller_id] || (product ? names.shops[product.seller_id] : null);
            const reporter = names.people[report.reporter_id];
            return (
              <li key={report.id} className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[report.status]}`}>
                    {report.status}
                  </span>
                  <span className="text-xs font-semibold uppercase text-gray-500">{report.target_type}</span>
                  <span className="font-semibold text-gray-900">
                    {report.target_type === 'product' ? product?.name || 'Removed product' : shop?.business_name || 'Removed shop'}
                  </span>
                  {report.target_type === 'product' && product && product.available === false && (
                    <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-700">hidden</span>
                  )}
                </div>
                <p className="mt-2 text-sm">
                  <span className="font-medium">Reason:</span> {report.reason}
                </p>
                {report.details && <p className="mt-1 whitespace-pre-line text-sm text-gray-700">{report.details}</p>}
                <p className="mt-1 text-xs text-gray-500">
                  By {reporter?.full_name || reporter?.email || 'a shopper'} ·{' '}
                  {new Date(report.created_at).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}
                </p>
                {report.admin_note && <p className="mt-1 text-xs text-gray-600">Note: {report.admin_note}</p>}

                {report.status === 'open' && (
                  <div className="mt-3 space-y-2">
                    <input
                      value={notes[report.id] || ''}
                      onChange={(event) => setNotes((current) => ({ ...current, [report.id]: event.target.value.slice(0, 500) }))}
                      placeholder="Note (what you checked or did)"
                      className="min-h-[40px] w-full rounded-lg border border-gray-300 px-3 text-sm"
                    />
                    <div className="flex flex-wrap gap-2">
                      {report.target_type === 'product' && product && product.available !== false && (
                        <button
                          type="button"
                          disabled={busyId === report.id}
                          onClick={() => hideProduct(report)}
                          className="min-h-[40px] rounded-lg border border-red-200 px-3 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          Hide product
                        </button>
                      )}
                      {report.target_type === 'product' && product && (
                        <a
                          href={`/shop?product=${product.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex min-h-[40px] items-center rounded-lg border border-gray-200 px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                        >
                          View product
                        </a>
                      )}
                      {report.target_type === 'shop' && onOpenSellers && (
                        <button
                          type="button"
                          onClick={onOpenSellers}
                          className="min-h-[40px] rounded-lg border border-gray-200 px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                        >
                          Go to Sellers
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busyId === report.id}
                        onClick={() => close(report, 'resolved')}
                        className="min-h-[40px] rounded-lg bg-green-600 px-3 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                      >
                        Mark resolved
                      </button>
                      <button
                        type="button"
                        disabled={busyId === report.id}
                        onClick={() => close(report, 'dismissed')}
                        className="min-h-[40px] rounded-lg border border-gray-200 px-3 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
