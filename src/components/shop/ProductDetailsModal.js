'use client';

import { useState } from 'react';

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
export default function ProductDetailsModal({ product, sellerInfo, onClose, onAddToCart, onBuyNow }) {
  const [quantity, setQuantity] = useState(1);

  if (!product) return null;

  const stock = Number(product.stock) || 0;
  const inStock = stock > 0;
  const price = Number(product.price) || 0;

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
                    <span className="text-sm font-semibold text-blue-600 truncate">
                      {sellerInfo.business_name}
                    </span>
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
      </div>
    </div>
  );
}
