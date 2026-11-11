'use client';

import { useEffect, useState } from 'react';
import StarRating from './StarRating';
import Avatar from '@/components/ui/Avatar';

const formatReviewDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
};

const categoryIcons = {
  handicrafts: '🧺',
  food: '🍽️',
  souvenirs: '🎁',
  weavings: '🧵',
  art: '🎨',
};

/**
 * Product quick view opened by clicking a product card: full description, seller,
 * artisan, stock and a quantity picker, with the same cart and buy actions.
 */
export default function ProductDetailsModal({
  product,
  sellerInfo,
  onViewShop,
  reviews = [],
  canReview = false,
  onSubmitReview,
  onClose,
  onAddToCart,
  onBuyNow,
}) {
  const [quantity, setQuantity] = useState(1);
  const [draftRating, setDraftRating] = useState(5);
  const [draftComment, setDraftComment] = useState('');
  const [savingReview, setSavingReview] = useState(false);
  const [reviewFeedback, setReviewFeedback] = useState(null);

  // Every product opens with a clean review draft.
  useEffect(() => {
    setDraftRating(5);
    setDraftComment('');
    setReviewFeedback(null);
    setQuantity(1);
  }, [product?.id]);

  // Escape closes the product window
  useEffect(() => {
    if (!product) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [product, onClose]);

  if (!product) return null;

  const stock = Number(product.stock) || 0;
  const inStock = stock > 0;
  const price = Number(product.price) || 0;
  const reviewCount = reviews.length;
  const averageRating = reviewCount
    ? reviews.reduce((sum, review) => sum + (Number(review.rating) || 0), 0) / reviewCount
    : 0;

  const handleReviewSubmit = async (event) => {
    event.preventDefault();
    if (!onSubmitReview) return;

    setSavingReview(true);
    setReviewFeedback(null);

    try {
      await onSubmitReview(product, { rating: draftRating, comment: draftComment });
      setDraftRating(5);
      setDraftComment('');
      setReviewFeedback({ type: 'success', message: 'Thank you for your review!' });
    } catch (error) {
      setReviewFeedback({
        type: 'error',
        message: error?.message || 'Could not save your review. Please try again.',
      });
    } finally {
      setSavingReview(false);
    }
  };

  const changeQuantity = (next) => {
    const clamped = Math.min(Math.max(1, next), Math.max(1, stock));
    setQuantity(clamped);
  };

  const handleAdd = () => {
    if (!inStock) return;
    onAddToCart(product, quantity);
    onClose();
  };

  const handleBuy = () => {
    if (!inStock) return;
    onClose();
    onBuyNow(product, quantity);
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="grid md:grid-cols-2">
          {/* Image */}
          <div className="relative bg-gray-100 min-h-[280px] md:min-h-full">
            {product.image_url ? (
              <img
                src={product.image_url}
                alt={product.name}
                className="w-full h-full max-h-[420px] object-cover md:rounded-l-2xl"
              />
            ) : (
              <div className="w-full h-full min-h-[280px] flex flex-col items-center justify-center text-gray-400">
                <svg className="w-20 h-20 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="text-xs font-medium">No image available</span>
              </div>
            )}

            {inStock && stock <= 5 && (
              <div className="absolute top-3 left-3 bg-yellow-500 text-white text-xs px-3 py-1.5 rounded-full font-bold shadow-lg">
                Only {stock} left!
              </div>
            )}
            {!inStock && (
              <div className="absolute top-3 left-3 bg-red-500 text-white text-xs px-3 py-1.5 rounded-full font-bold shadow-lg">
                Sold Out
              </div>
            )}
          </div>

          {/* Details */}
          <div className="p-6 flex flex-col">
            <div className="flex items-start justify-between gap-3 mb-3">
              {product.category && (
                <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-xs px-3 py-1.5 rounded-full font-semibold capitalize">
                  <span>{categoryIcons[product.category] || '🏪'}</span>
                  {product.category}
                </span>
              )}
              <button
                onClick={onClose}
                aria-label="Close product details"
                className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full p-1.5 transition-colors flex-shrink-0"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <h2 className="text-2xl font-bold text-gray-900 mb-2">{product.name}</h2>

            <div className="flex items-end gap-3 mb-4">
              <span className="text-3xl font-bold text-blue-600">₱{price.toFixed(2)}</span>
              <span className={`text-sm font-semibold ${inStock ? 'text-green-600' : 'text-red-600'}`}>
                {inStock ? `${stock} in stock` : 'Out of stock'}
              </span>
            </div>

            {(sellerInfo || product.artisan_name) && (
              <div className="space-y-2 mb-4 pb-4 border-b border-gray-100">
                {sellerInfo?.business_name && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-16">Sold by</span>
                    {onViewShop ? (
                      <button
                        type="button"
                        onClick={onViewShop}
                        className="min-h-[36px] truncate text-sm font-semibold text-blue-600 underline-offset-2 hover:underline"
                      >
                        {sellerInfo.business_name} →
                      </button>
                    ) : (
                      <span className="text-sm font-semibold text-blue-600 truncate">
                        {sellerInfo.business_name}
                      </span>
                    )}
                  </div>
                )}
                {product.artisan_name && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-16">Artisan</span>
                    <span className="text-sm font-medium text-gray-800 truncate">
                      {product.artisan_name}
                    </span>
                  </div>
                )}
              </div>
            )}

            <div className="mb-6">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Product Description
              </p>
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">
                {product.description || 'Authentic Daet product handcrafted with care.'}
              </p>
            </div>

            {/* Quantity */}
            <div className="mt-auto">
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-semibold text-gray-700">Quantity</span>
                <div className="flex items-center gap-3 bg-gray-100 rounded-lg p-1">
                  <button
                    onClick={() => changeQuantity(quantity - 1)}
                    disabled={quantity <= 1 || !inStock}
                    className="bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed rounded-md w-8 h-8 flex items-center justify-center font-bold text-gray-700 shadow-sm transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                    </svg>
                  </button>
                  <span className="font-bold w-8 text-center text-gray-900">{quantity}</span>
                  <button
                    onClick={() => changeQuantity(quantity + 1)}
                    disabled={quantity >= stock || !inStock}
                    className="bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed rounded-md w-8 h-8 flex items-center justify-center font-bold text-gray-700 shadow-sm transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleAdd}
                  disabled={!inStock}
                  className="flex-1 py-3.5 rounded-lg font-bold border-2 border-blue-600 text-blue-600 hover:bg-blue-50 disabled:border-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                >
                  Add to Cart
                </button>
                <button
                  onClick={handleBuy}
                  disabled={!inStock}
                  className="flex-1 py-3.5 rounded-lg font-bold bg-gradient-to-r from-blue-600 to-blue-700 text-white hover:from-blue-700 hover:to-blue-800 disabled:from-gray-200 disabled:to-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed shadow-md transition-all flex items-center justify-center gap-2"
                >
                  Buy Now
                </button>
              </div>

              {inStock && (
                <p className="text-xs text-gray-500 mt-3 text-center">
                  Total for {quantity} {quantity === 1 ? 'item' : 'items'}:{' '}
                  <span className="font-semibold text-gray-700">₱{(price * quantity).toFixed(2)}</span>
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Reviews: public, from customers whose order was delivered */}
        <section className="border-t border-gray-100 p-6">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <h3 className="text-lg font-bold text-gray-900">Reviews</h3>
            {reviewCount > 0 ? (
              <div className="flex items-center gap-2">
                <StarRating rating={averageRating} />
                <span className="text-sm font-bold text-gray-800">{averageRating.toFixed(1)}</span>
                <span className="text-xs text-gray-500">
                  ({reviewCount} {reviewCount === 1 ? 'review' : 'reviews'})
                </span>
              </div>
            ) : (
              <span className="text-sm text-gray-500">No reviews yet</span>
            )}
          </div>

          {reviewFeedback?.type === 'success' && (
            <p className="mb-4 text-sm font-semibold text-green-700" role="status">
              {reviewFeedback.message}
            </p>
          )}

          {reviewCount === 0 ? (
            <p className="text-sm text-gray-500">
              Be the first to review this product once your order has been delivered.
            </p>
          ) : (
            <ul className="space-y-3">
              {reviews.slice(0, 3).map((review) => (
                <li key={review.id} className="flex gap-3 rounded-xl bg-gray-50 p-4">
                  {/* Who wrote it: the name and picture are stored on the
                      review itself, because profiles are private. */}
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
                      <span className="text-xs text-gray-500">{formatReviewDate(review.created_at)}</span>
                    </div>

                    <div className="mb-1.5 flex items-center gap-2">
                      <StarRating rating={review.rating} />
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700">
                        Verified purchase
                      </span>
                    </div>

                    {review.comment && (
                      <p className="whitespace-pre-line text-sm leading-relaxed text-gray-700">{review.comment}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {canReview && (
            <form onSubmit={handleReviewSubmit} className="mt-5 bg-blue-50 rounded-xl p-4">
              <p className="text-sm font-semibold text-gray-900 mb-2">
                Your order was delivered — rate this product
              </p>
              <div className="flex items-center gap-1 mb-3">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setDraftRating(star)}
                    aria-label={`${star} star${star === 1 ? '' : 's'}`}
                    aria-pressed={draftRating === star}
                    className="p-1"
                  >
                    <svg
                      className={`w-7 h-7 transition-colors ${star <= draftRating ? 'text-yellow-500' : 'text-gray-300'} hover:text-yellow-500`}
                      fill="currentColor"
                      viewBox="0 0 20 20"
                      aria-hidden="true"
                    >
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                  </button>
                ))}
              </div>
              <textarea
                rows={3}
                maxLength={1000}
                value={draftComment}
                onChange={(event) => setDraftComment(event.target.value)}
                placeholder="Tell other buyers what you liked (optional)"
                className="w-full rounded-lg border border-gray-200 p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <div className="flex flex-wrap items-center justify-between gap-3 mt-3">
                <p
                  className={`text-xs ${reviewFeedback?.type === 'error' ? 'text-red-600' : 'text-gray-500'}`}
                  role="status"
                >
                  {reviewFeedback?.type === 'error' ? reviewFeedback.message : ''}
                </p>
                <button
                  type="submit"
                  disabled={savingReview}
                  className="bg-blue-600 text-white text-sm font-bold px-4 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  {savingReview ? 'Submitting...' : 'Submit Review'}
                </button>
              </div>
            </form>
          )}

          {!canReview && reviewCount > 0 && (
            <p className="mt-4 text-xs text-gray-500">
              Reviews are written by customers whose order for this product was delivered.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
