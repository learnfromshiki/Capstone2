'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { moderateReview } from '@/lib/returns';
import { useDialog } from '@/components/ui/Dialog';
import StarRating from './StarRating';
import Img from '@/components/ui/Img';

/**
 * Admin review moderation: every recent review, with Hide / Show / Delete for
 * abusive or fake ones. Hidden reviews leave the shop but stay here.
 */
export default function AdminReviews() {
  const { showConfirm, showAlert, showToast } = useDialog();
  const [reviews, setReviews] = useState([]);
  const [products, setProducts] = useState({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('shop_reviews')
      .select('id, product_id, rating, comment, created_at, reviewer_name, photos, seller_reply, is_hidden')
      .order('created_at', { ascending: false })
      .limit(300);
    if (error) {
      setLoading(false);
      showAlert(
        /column/i.test(error.message || '')
          ? 'Review moderation is not set up yet. Run supabase-returns-reviews.sql in Supabase.'
          : error.message
      );
      return;
    }
    const ids = [...new Set((data || []).map((review) => review.product_id).filter(Boolean))];
    if (ids.length > 0) {
      const { data: rows } = await supabase.from('shop_products').select('id, name, image_url').in('id', ids);
      setProducts(Object.fromEntries((rows || []).map((row) => [row.id, row])));
    }
    setReviews(data || []);
    setLoading(false);
  }, [showAlert]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (review, action) => {
    if (action === 'delete') {
      const confirmed = await showConfirm({
        tone: 'warning',
        title: 'Delete this review?',
        message: 'It is removed for good, with its photos and the shop reply. Hide it instead if you may need it later.',
        confirmLabel: 'Delete',
        cancelLabel: 'Keep it',
      });
      if (!confirmed) return;
    }
    setBusyId(review.id);
    try {
      await moderateReview(review.id, action);
      if (action === 'delete') setReviews((current) => current.filter((entry) => entry.id !== review.id));
      else
        setReviews((current) =>
          current.map((entry) => (entry.id === review.id ? { ...entry, is_hidden: action === 'hide' } : entry))
        );
      showToast(action === 'hide' ? 'Review hidden from the shop.' : action === 'show' ? 'Review visible again.' : 'Review deleted.', 'success');
    } catch (error) {
      showAlert(error.message);
    } finally {
      setBusyId(null);
    }
  };

  const shown = reviews.filter((review) =>
    filter === 'hidden' ? review.is_hidden : filter === 'low' ? Number(review.rating) <= 2 : true
  );

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-xl font-bold">Reviews</h3>
          <p className="text-sm text-gray-600">Hide or delete reviews that are abusive, fake or off-topic.</p>
        </div>
        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          aria-label="Filter reviews"
          className="min-h-[44px] rounded-lg border-2 px-3"
        >
          <option value="all">All reviews ({reviews.length})</option>
          <option value="low">1–2 stars ({reviews.filter((review) => Number(review.rating) <= 2).length})</option>
          <option value="hidden">Hidden ({reviews.filter((review) => review.is_hidden).length})</option>
        </select>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading reviews…</p>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-gray-100 bg-white p-10 text-center text-gray-500">No reviews here.</div>
      ) : (
        <ul className="space-y-3">
          {shown.map((review) => {
            const product = products[review.product_id];
            return (
              <li
                key={review.id}
                className={`rounded-xl border bg-white p-4 shadow-sm ${review.is_hidden ? 'border-gray-300 opacity-75' : 'border-gray-100'}`}
              >
                <div className="flex flex-col gap-3 sm:flex-row">
                  <div className="flex min-w-0 flex-1 gap-3">
                    <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg bg-gray-100">
                      {product?.image_url && <Img src={product.image_url} alt="" width={96} className="h-full w-full object-cover" />}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-gray-900">{product?.name || 'Removed product'}</p>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                        <StarRating rating={review.rating} />
                        <span>{review.reviewer_name || 'Customer'}</span>
                        <span>{new Date(review.created_at).toLocaleDateString('en-PH', { dateStyle: 'medium' })}</span>
                        {review.is_hidden && (
                          <span className="rounded-full bg-gray-200 px-2 py-0.5 font-semibold text-gray-700">Hidden</span>
                        )}
                      </div>
                      {review.comment && <p className="mt-1 whitespace-pre-line text-sm text-gray-700">{review.comment}</p>}
                      {Array.isArray(review.photos) && review.photos.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {review.photos.map((url) => (
                            <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                              <Img src={url} alt="Review photo" width={96} className="h-12 w-12 rounded-lg object-cover" />
                            </a>
                          ))}
                        </div>
                      )}
                      {review.seller_reply && (
                        <p className="mt-2 border-l-4 border-blue-300 pl-2 text-xs text-gray-600">
                          <span className="font-semibold">Shop reply:</span> {review.seller_reply}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 gap-2 sm:flex-col">
                    <button
                      type="button"
                      disabled={busyId === review.id}
                      onClick={() => act(review, review.is_hidden ? 'show' : 'hide')}
                      className="min-h-[40px] rounded-lg border border-gray-300 px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      {review.is_hidden ? 'Show' : 'Hide'}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === review.id}
                      onClick={() => act(review, 'delete')}
                      className="min-h-[40px] rounded-lg border border-red-200 px-3 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
