'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import StarRating from './StarRating';
import Avatar from '@/components/ui/Avatar';

const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString('en-PH', { dateStyle: 'medium' }) : '';

/**
 * Every review a shop's product has received.
 *
 * A seller cannot read customer profiles, by design, so the reviewer's name,
 * picture and photos are the copies stored on the review itself.
 */
export default function ProductReviewsModal({ product, onClose }) {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!product?.id) return undefined;

    let cancelled = false;
    setLoading(true);

    const columns = 'id, rating, comment, created_at';
    const read = (select) =>
      supabase
        .from('shop_reviews')
        .select(select)
        .eq('product_id', product.id)
        .order('created_at', { ascending: false })
        .limit(100);

    (async () => {
      // Author columns and photos are later additions; step back so an older
      // database still shows the ratings it has.
      let { data, error } = await read(`${columns}, reviewer_name, reviewer_avatar_url, photos`);

      if (error && /photos|column/i.test(error.message || '')) {
        ({ data, error } = await read(`${columns}, reviewer_name, reviewer_avatar_url`));
      }
      if (error && /reviewer_name|reviewer_avatar_url|column/i.test(error.message || '')) {
        ({ data, error } = await read(columns));
      }

      if (cancelled) return;

      if (error) console.warn('Could not load the reviews:', error.message);
      setReviews(error ? [] : data || []);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [product?.id]);

  useEffect(() => {
    if (!product) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [product, onClose]);

  if (!product) return null;

  const average = reviews.length
    ? reviews.reduce((sum, review) => sum + (Number(review.rating) || 0), 0) / reviews.length
    : 0;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Reviews for ${product.name}`}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b p-5">
          <div className="flex min-w-0 gap-3">
            <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-xl bg-gray-100">
              {product.image_url ? (
                <img src={product.image_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-[10px] text-gray-400">No image</div>
              )}
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-bold text-gray-900">{product.name}</h2>
              {reviews.length > 0 ? (
                <div className="mt-0.5 flex items-center gap-2">
                  <StarRating rating={average} />
                  <span className="text-sm font-bold text-gray-800">{average.toFixed(1)}</span>
                  <span className="text-xs text-gray-500">
                    ({reviews.length} {reviews.length === 1 ? 'review' : 'reviews'})
                  </span>
                </div>
              ) : (
                <p className="text-sm text-gray-500">No reviews yet</p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close reviews"
            className="flex min-h-[44px] min-w-[44px] flex-shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5">
          {loading ? (
            <p className="py-8 text-center text-sm text-gray-500">Loading reviews...</p>
          ) : reviews.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">
              No one has reviewed this product yet. Reviews appear once a customer&apos;s order is delivered.
            </p>
          ) : (
            <ul className="space-y-3">
              {reviews.map((review) => (
                <li key={review.id} className="flex gap-3 rounded-xl bg-gray-50 p-4">
                  <Avatar
                    src={review.reviewer_avatar_url}
                    name={review.reviewer_name}
                    size="sm"
                    className="mt-0.5"
                  />

                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-gray-900">
                        {review.reviewer_name || 'Customer'}
                      </p>
                      <span className="text-xs text-gray-500">{formatDate(review.created_at)}</span>
                    </div>

                    <StarRating rating={review.rating} />

                    {review.comment && (
                      <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-gray-700">
                        {review.comment}
                      </p>
                    )}

                    {Array.isArray(review.photos) && review.photos.length > 0 && (
                      <ul className="mt-2 flex flex-wrap gap-2">
                        {review.photos.map((url) => (
                          <li key={url}>
                            <a href={url} target="_blank" rel="noopener noreferrer">
                              <img
                                src={url}
                                alt="Customer photo"
                                className="h-16 w-16 rounded-lg border border-gray-200 object-cover transition-transform hover:scale-105"
                              />
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
