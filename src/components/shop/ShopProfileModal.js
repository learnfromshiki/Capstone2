'use client';

import { useEffect } from 'react';
import StarRating from './StarRating';

/**
 * The public page of one shop: who they are and everything they sell.
 * Opened from the "Sold by" name on a product card or in the product window.
 */
export default function ShopProfileModal({
  seller,
  products = [],
  reviewSummaries = {},
  onClose,
  onViewProduct,
  onMessageShop,
}) {
  // Escape closes the shop window
  useEffect(() => {
    if (!seller) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [seller, onClose]);

  if (!seller) return null;

  const inStock = products.filter((product) => (Number(product.stock) || 0) > 0);

  // One rating for the whole shop, averaged over every product that has reviews
  const rated = products
    .map((product) => reviewSummaries[product.id])
    .filter((summary) => summary && summary.count > 0);

  const reviewCount = rated.reduce((sum, summary) => sum + summary.count, 0);
  const shopRating = reviewCount
    ? rated.reduce((sum, summary) => sum + summary.average * summary.count, 0) / reviewCount
    : null;

  const memberSince = seller.created_at
    ? new Date(seller.created_at).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
    : null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${seller.business_name} shop profile`}
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl"
      >
        {/* Shop header */}
        <div className="relative bg-gradient-to-r from-blue-600 to-blue-700 p-6 text-white">
          <button
            onClick={onClose}
            aria-label="Close shop profile"
            className="absolute right-2 top-2 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/20 hover:text-white"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full bg-white/20 text-2xl font-bold">
              {(seller.business_name || '?').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-2xl font-bold">{seller.business_name}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-blue-100">
                <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold">Verified Seller</span>
                {memberSince && <span className="text-xs">Selling since {memberSince}</span>}
              </div>
            </div>
          </div>

          {onMessageShop && (
            <button
              type="button"
              onClick={() => onMessageShop(seller)}
              className="mt-4 min-h-[44px] rounded-full bg-white px-5 text-sm font-bold text-blue-700 transition-colors hover:bg-blue-50"
            >
              💬 Message this shop
            </button>
          )}

          <div className="mt-4 flex flex-wrap gap-6 text-sm">
            <div>
              <p className="text-xl font-bold">{products.length}</p>
              <p className="text-xs text-blue-100">{products.length === 1 ? 'Product' : 'Products'}</p>
            </div>
            <div>
              <p className="text-xl font-bold">{inStock.length}</p>
              <p className="text-xs text-blue-100">In stock</p>
            </div>
            <div>
              <p className="text-xl font-bold">
                {shopRating ? shopRating.toFixed(1) : '—'}
              </p>
              <p className="text-xs text-blue-100">
                {reviewCount ? `From ${reviewCount} ${reviewCount === 1 ? 'review' : 'reviews'}` : 'No reviews yet'}
              </p>
            </div>
          </div>
        </div>

        <div className="p-6">
          {seller.description && (
            <div className="mb-6">
              <h3 className="mb-1 text-sm font-bold text-gray-900">About this shop</h3>
              <p className="whitespace-pre-line text-sm text-gray-600">{seller.description}</p>
            </div>
          )}

          <h3 className="mb-3 text-sm font-bold text-gray-900">
            {products.length === 0 ? 'No products listed yet' : `Products from ${seller.business_name}`}
          </h3>

          {products.length > 0 && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {products.map((product) => {
                const summary = reviewSummaries[product.id];
                const stock = Number(product.stock) || 0;

                return (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => onViewProduct(product)}
                    className="overflow-hidden rounded-xl border border-gray-100 text-left transition-shadow hover:shadow-md"
                  >
                    <div className="h-28 bg-gray-100">
                      {product.image_url ? (
                        <img src={product.image_url} alt={product.name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-xs text-gray-400">No image</div>
                      )}
                    </div>
                    <div className="p-3">
                      <p className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold text-gray-900">{product.name}</p>
                      <p className="mt-1 font-bold text-blue-600">₱{Number(product.price).toFixed(2)}</p>
                      {summary && (
                        <div className="mt-1 flex items-center gap-1">
                          <StarRating rating={summary.average} />
                          <span className="text-xs text-gray-500">({summary.count})</span>
                        </div>
                      )}
                      <p className={`mt-1 text-xs ${stock > 0 ? 'text-gray-500' : 'text-red-600 font-semibold'}`}>
                        {stock > 0 ? `${stock} in stock` : 'Sold out'}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
