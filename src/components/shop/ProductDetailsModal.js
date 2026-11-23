'use client';

import { useEffect, useRef, useState } from 'react';
import StarRating from './StarRating';
import LikeButton from './LikeButton';
import Avatar from '@/components/ui/Avatar';
import Img from '@/components/ui/Img';
import { describeVoucher, formatSold, saleInfo, shareProduct } from '@/lib/shopFeatures';

/** A row of small product tiles: "More from this shop", "You may also like". */
function ProductStrip({ title, items, onSelect, soldCounts = {} }) {
  if (!items || items.length === 0) return null;
  return (
    <section className="border-t border-gray-100 p-6">
      <h3 className="mb-3 text-lg font-bold text-gray-900">{title}</h3>
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
        {items.map((item) => {
          const sale = saleInfo(item);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item)}
              className="w-36 flex-shrink-0 overflow-hidden rounded-xl border border-gray-100 bg-white text-left shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="relative aspect-square w-full bg-gray-100">
                {item.image_url ? (
                  <Img src={item.image_url} alt={item.name} width={288} className="absolute inset-0 h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-[10px] text-gray-400">No image</div>
                )}
                {sale && (
                  <span className="absolute right-1 top-1 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    -{sale.percent}%
                  </span>
                )}
              </div>
              <div className="p-2">
                <p className="line-clamp-2 min-h-[2rem] text-xs text-gray-900">{item.name}</p>
                <p className="mt-1 text-sm font-bold text-blue-600">₱{Number(item.price).toFixed(2)}</p>
                {soldCounts[item.id] > 0 && (
                  <p className="text-[10px] text-gray-500">{formatSold(soldCounts[item.id])} sold</p>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

const formatReviewDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
};

// Shopee and Lazada both stop at five, and more than that is unreadable in a
// review card anyway.
const MAX_REVIEW_PHOTOS = 5;

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
  onMessageShop,
  reviews = [],
  canReview = false,
  onSubmitReview,
  onClose,
  onAddToCart,
  onBuyNow,
  sold = 0,
  soldCounts = {},
  liked = false,
  onToggleLike,
  vouchers = [],
  freeShippingThreshold = null,
  moreFromShop = [],
  similarProducts = [],
  onSelectProduct,
  onReport,
}) {
  const [quantity, setQuantity] = useState(1);
  // Reviews: which stars to show (0 = all, 'photos' = only with photos), and
  // whether the whole list is open.
  const [reviewFilter, setReviewFilter] = useState(0);
  const [showAllReviews, setShowAllReviews] = useState(false);
  const [shareNote, setShareNote] = useState('');
  const [copiedCode, setCopiedCode] = useState('');
  const [draftRating, setDraftRating] = useState(5);
  const [draftComment, setDraftComment] = useState('');
  const [savingReview, setSavingReview] = useState(false);
  const [reviewFeedback, setReviewFeedback] = useState(null);
  const [activeImage, setActiveImage] = useState(0);
  // Photos the shopper is attaching to their own review (up to five)
  const [reviewPhotos, setReviewPhotos] = useState([]);
  const reviewFileRef = useRef(null);
  // A second input with `capture` opens the phone's camera instead of its
  // gallery; a laptop falls back to a normal file picker.
  const reviewCameraRef = useRef(null);
  // Opening another product from "More from this shop" starts at the top.
  const scrollRef = useRef(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [product?.id]);

  // Every product opens with a clean review draft and its first photo.
  useEffect(() => {
    setDraftRating(5);
    setDraftComment('');
    setReviewFeedback(null);
    setQuantity(1);
    setActiveImage(0);
    setReviewFilter(0);
    setShowAllReviews(false);
    setShareNote('');
    setCopiedCode('');
    setReviewPhotos((current) => {
      current.forEach((photo) => URL.revokeObjectURL(photo.preview));
      return [];
    });
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

  // The cover photo leads, then any extra photos the seller uploaded.
  const gallery = [
    product.image_url,
    ...(Array.isArray(product.images) ? product.images : []),
  ].filter((url, index, all) => url && all.indexOf(url) === index);

  const stock = Number(product.stock) || 0;
  const inStock = stock > 0;
  const price = Number(product.price) || 0;
  const reviewCount = reviews.length;
  const averageRating = reviewCount
    ? reviews.reduce((sum, review) => sum + (Number(review.rating) || 0), 0) / reviewCount
    : 0;
  const sale = saleInfo(product);

  // How many reviews gave each number of stars, for the bars.
  const starCounts = [5, 4, 3, 2, 1].map((stars) => ({
    stars,
    count: reviews.filter((review) => Math.round(Number(review.rating) || 0) === stars).length,
  }));
  const withPhotos = reviews.filter((review) => Array.isArray(review.photos) && review.photos.length > 0);
  const filteredReviews =
    reviewFilter === 'photos'
      ? withPhotos
      : reviewFilter
        ? reviews.filter((review) => Math.round(Number(review.rating) || 0) === reviewFilter)
        : reviews;
  const shownReviews = showAllReviews ? filteredReviews : filteredReviews.slice(0, 3);

  const handleShare = async () => {
    const result = await shareProduct(product);
    setShareNote(
      result === 'copied' ? 'Link copied' : result === 'shared' ? 'Shared' : result === 'failed' ? 'Could not share' : ''
    );
    setTimeout(() => setShareNote(''), 2500);
  };

  const copyCode = async (code) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(''), 2000);
    } catch (error) {
      setCopiedCode('');
    }
  };

  const handleReviewSubmit = async (event) => {
    event.preventDefault();
    if (!onSubmitReview) return;

    setSavingReview(true);
    setReviewFeedback(null);

    try {
      await onSubmitReview(product, {
        rating: draftRating,
        comment: draftComment,
        photos: reviewPhotos.map((photo) => photo.file),
      });
      setDraftRating(5);
      setDraftComment('');
      reviewPhotos.forEach((photo) => URL.revokeObjectURL(photo.preview));
      setReviewPhotos([]);
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

  const addReviewPhotos = (event) => {
    const chosen = Array.from(event.target.files || []);
    event.target.value = '';
    if (chosen.length === 0) return;

    const images = chosen.filter((file) => file.type.startsWith('image/'));
    if (images.length !== chosen.length) {
      setReviewFeedback({ type: 'error', message: 'Only photos can be added to a review.' });
    }

    setReviewPhotos((current) => {
      const room = MAX_REVIEW_PHOTOS - current.length;

      if (images.length > room) {
        setReviewFeedback({
          type: 'error',
          message: `A review can have at most ${MAX_REVIEW_PHOTOS} photos, so only the first ${room} ${
            room === 1 ? 'was' : 'were'
          } added.`,
        });
      }

      return [
        ...current,
        ...images.slice(0, Math.max(0, room)).map((file) => ({ file, preview: URL.createObjectURL(file) })),
      ];
    });
  };

  const removeReviewPhoto = (index) => {
    setReviewPhotos((current) => {
      const photo = current[index];
      if (photo) URL.revokeObjectURL(photo.preview);
      return current.filter((_, position) => position !== index);
    });
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
      className="modal-backdrop fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        ref={scrollRef}
        className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="grid md:grid-cols-2">
          {/* Photos */}
          <div className="relative bg-gray-100 min-h-[280px] md:min-h-full">
            {gallery.length > 0 ? (
              <div className="flex h-full flex-col">
                <Img
                  src={gallery[activeImage] || gallery[0]}
                  alt={`${product.name} photo ${activeImage + 1} of ${gallery.length}`}
                  className="w-full flex-1 max-h-[360px] object-cover md:rounded-tl-2xl"
                />

                {gallery.length > 1 && (
                  <div className="flex gap-2 overflow-x-auto bg-white/80 p-3">
                    {gallery.map((url, index) => (
                      <button
                        key={url}
                        type="button"
                        onClick={() => setActiveImage(index)}
                        aria-label={`Show photo ${index + 1}`}
                        aria-pressed={index === activeImage}
                        className={`h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg border-2 transition-colors ${
                          index === activeImage ? 'border-blue-600' : 'border-transparent hover:border-gray-300'
                        }`}
                      >
                        <Img src={url} alt="" className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="w-full h-full min-h-[280px] flex flex-col items-center justify-center text-gray-400">
                <svg className="w-20 h-20 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="text-xs font-medium">No image available</span>
              </div>
            )}

            {inStock && stock <= 5 && (
              <div className="absolute top-3 left-3 bg-amber-100 text-amber-900 text-xs px-3 py-1.5 rounded-full font-bold shadow-md ring-1 ring-amber-300">
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

            <div className="mb-2 flex items-start gap-2">
              <h2 className="min-w-0 flex-1 text-2xl font-bold text-gray-900">{product.name}</h2>
              <div className="flex flex-shrink-0 items-center gap-1">
                {onToggleLike && (
                  <LikeButton
                    liked={liked}
                    onToggle={() => onToggleLike(product)}
                    productName={product.name}
                    size="sm"
                    className="border border-gray-200 shadow-none"
                  />
                )}
                <button
                  type="button"
                  onClick={handleShare}
                  aria-label={`Share ${product.name}`}
                  title="Share"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 text-gray-600 transition-colors hover:bg-gray-50"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12s-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                </button>
              </div>
            </div>
            {shareNote && <p className="-mt-1 mb-2 text-right text-xs font-semibold text-green-700" role="status">{shareNote}</p>}

            <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600">
              {reviewCount > 0 && (
                <span className="flex items-center gap-1">
                  <span className="font-semibold text-gray-900 underline">{averageRating.toFixed(1)}</span>
                  <StarRating rating={averageRating} />
                </span>
              )}
              {reviewCount > 0 && <span className="text-gray-300">|</span>}
              {reviewCount > 0 && <span>{reviewCount} {reviewCount === 1 ? 'rating' : 'ratings'}</span>}
              {sold > 0 && reviewCount > 0 && <span className="text-gray-300">|</span>}
              {sold > 0 && <span>{formatSold(sold)} sold</span>}
            </div>

            <div className="mb-4 flex flex-wrap items-end gap-x-3 gap-y-1 rounded-xl bg-gray-50 px-3 py-2">
              {sale && <span className="text-base text-gray-400 line-through">₱{sale.original.toFixed(2)}</span>}
              <span className="text-3xl font-bold text-blue-600">₱{price.toFixed(2)}</span>
              {sale && (
                <span className="rounded bg-red-600 px-1.5 py-0.5 text-xs font-bold text-white">-{sale.percent}%</span>
              )}
              <span className={`ml-auto text-sm font-semibold ${inStock ? 'text-green-600' : 'text-red-600'}`}>
                {inStock ? `${stock} in stock` : 'Out of stock'}
              </span>
            </div>

            {/* Shop vouchers */}
            {vouchers.length > 0 && (
              <div className="mb-4">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">Shop vouchers</p>
                <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                  {vouchers.map((voucher) => {
                    const text = describeVoucher(voucher);
                    return (
                      <div
                        key={voucher.id}
                        className="flex flex-shrink-0 items-center gap-3 rounded-lg border border-dashed border-red-300 bg-red-50 px-3 py-2"
                      >
                        <div>
                          <p className="text-sm font-bold text-red-700">{text.headline}</p>
                          <p className="text-[11px] text-red-600">{text.minimum}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => copyCode(voucher.code)}
                          className="min-h-[32px] rounded-md bg-red-600 px-2 font-mono text-xs font-bold text-white hover:bg-red-700"
                          title="Copy code, then enter it at checkout"
                        >
                          {copiedCode === voucher.code ? 'Copied!' : voucher.code}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {freeShippingThreshold > 0 && (
              <p className="mb-4 flex items-center gap-2 text-sm text-green-700">
                <span aria-hidden="true">🚚</span>
                Free delivery within Daet on orders of ₱{Number(freeShippingThreshold).toLocaleString('en-PH')}+ from this shop
              </p>
            )}

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
                    {onMessageShop && (
                      <button
                        type="button"
                        onClick={() => onMessageShop(sellerInfo)}
                        className="ml-auto min-h-[36px] whitespace-nowrap rounded-full border border-blue-200 px-3 text-xs font-semibold text-blue-600 hover:bg-blue-50"
                      >
                        💬 Message shop
                      </button>
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
              {onReport && (
                <button
                  type="button"
                  onClick={() => onReport({ type: 'product', productId: product.id, name: product.name })}
                  className="mt-2 text-xs font-medium text-gray-400 hover:text-red-600 hover:underline"
                >
                  ⚑ Report this product
                </button>
              )}
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

          {reviewCount > 0 && (
            <div className="mb-4 rounded-xl border border-gray-100 bg-amber-50/50 p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="text-center sm:w-32">
                  <p className="text-3xl font-bold text-amber-600">
                    {averageRating.toFixed(1)}
                    <span className="text-base text-gray-500"> / 5</span>
                  </p>
                  <div className="mt-1 flex justify-center">
                    <StarRating rating={averageRating} />
                  </div>
                </div>
                <ul className="flex-1 space-y-1">
                  {starCounts.map(({ stars, count }) => (
                    <li key={stars} className="flex items-center gap-2 text-xs text-gray-600">
                      <span className="w-6 text-right">{stars}★</span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-gray-200">
                        <span
                          className="block h-full rounded-full bg-amber-400"
                          style={{ width: `${reviewCount ? (count / reviewCount) * 100 : 0}%` }}
                        />
                      </span>
                      <span className="w-6">{count}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {[
                  { value: 0, label: `All (${reviewCount})` },
                  ...starCounts.map(({ stars, count }) => ({ value: stars, label: `${stars} Star (${count})` })),
                  { value: 'photos', label: `With photos (${withPhotos.length})` },
                ].map((chip) => (
                  <button
                    key={chip.value}
                    type="button"
                    onClick={() => {
                      setReviewFilter(chip.value);
                      setShowAllReviews(false);
                    }}
                    aria-pressed={reviewFilter === chip.value}
                    className={`min-h-[32px] rounded-md border px-3 text-xs font-medium transition-colors ${
                      reviewFilter === chip.value
                        ? 'border-blue-600 bg-white text-blue-600'
                        : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {reviewCount === 0 ? (
            <p className="text-sm text-gray-500">
              Be the first to review this product once your order has been delivered.
            </p>
          ) : filteredReviews.length === 0 ? (
            <p className="text-sm text-gray-500">No reviews match this filter yet.</p>
          ) : (
            <ul className="space-y-3">
              {shownReviews.map((review) => (
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

                    {review.seller_reply && (
                      <div className="mt-2 rounded-lg border-l-4 border-blue-400 bg-white px-3 py-2 text-sm">
                        <p className="text-xs font-semibold text-blue-700">
                          Shop reply{sellerInfo?.business_name ? ` · ${sellerInfo.business_name}` : ''}
                        </p>
                        <p className="whitespace-pre-line text-gray-700">{review.seller_reply}</p>
                      </div>
                    )}

                    {Array.isArray(review.photos) && review.photos.length > 0 && (
                      <ul className="mt-2 flex flex-wrap gap-2">
                        {review.photos.map((url) => (
                          <li key={url}>
                            <a href={url} target="_blank" rel="noopener noreferrer">
                              <Img
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

          {filteredReviews.length > 3 && (
            <button
              type="button"
              onClick={() => setShowAllReviews((open) => !open)}
              className="mt-3 min-h-[40px] w-full rounded-lg border border-gray-200 text-sm font-semibold text-blue-600 hover:bg-gray-50"
            >
              {showAllReviews ? 'Show fewer reviews' : `See all ${filteredReviews.length} reviews`}
            </button>
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
              {/* Photos of the product as it arrived */}
              <div className="mt-3">
                <div className="flex flex-wrap items-center gap-2">
                  {reviewPhotos.map((photo, index) => (
                    <div key={photo.preview} className="relative">
                      <Img src={photo.preview} alt="" className="h-16 w-16 rounded-lg object-cover" />
                      <button
                        type="button"
                        onClick={() => removeReviewPhoto(index)}
                        aria-label={`Remove photo ${index + 1}`}
                        className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-gray-800 text-white shadow hover:bg-black"
                      >
                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}

                  {reviewPhotos.length < MAX_REVIEW_PHOTOS && (
                    <>
                      <input
                        ref={reviewFileRef}
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={addReviewPhotos}
                        className="hidden"
                      />
                      {/* `capture` asks the phone for its camera rather than
                          its gallery. A laptop ignores it and opens the usual
                          file picker, so the button works everywhere. */}
                      <input
                        ref={reviewCameraRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={addReviewPhotos}
                        className="hidden"
                      />

                      <button
                        type="button"
                        onClick={() => reviewCameraRef.current?.click()}
                        aria-label="Take a photo with the camera"
                        title="Take a photo"
                        className="flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-blue-200 bg-blue-50 text-blue-600 transition-colors hover:border-blue-500 hover:bg-blue-100"
                      >
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        <span className="text-[10px] font-semibold">Camera</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => reviewFileRef.current?.click()}
                        aria-label="Choose photos from this device"
                        title="Choose photos"
                        className="flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-dashed border-gray-300 text-gray-500 transition-colors hover:border-blue-500 hover:text-blue-600"
                      >
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <span className="text-[10px] font-semibold">Gallery</span>
                      </button>
                    </>
                  )}
                </div>
                <p className="mt-1.5 text-xs text-gray-500">
                  {reviewPhotos.length}/{MAX_REVIEW_PHOTOS} photos. Show other shoppers how it arrived.
                </p>
              </div>

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

        {onSelectProduct && (
          <>
            <ProductStrip
              title={sellerInfo?.business_name ? `More from ${sellerInfo.business_name}` : 'More from this shop'}
              items={moreFromShop}
              onSelect={onSelectProduct}
              soldCounts={soldCounts}
            />
            <ProductStrip
              title="You may also like"
              items={similarProducts}
              onSelect={onSelectProduct}
              soldCounts={soldCounts}
            />
          </>
        )}
      </div>
    </div>
  );
}
