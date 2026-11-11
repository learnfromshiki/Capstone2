'use client';

import StarRating from './StarRating';

export default function ProductCard({
  product,
  onAddToCart,
  onBuyNow,
  onViewDetails,
  sellerInfo,
  reviewSummary,
  onViewShop,
  onToggleWishlist,
  isWishlisted = false,
}) {
  const categoryIcons = {
    handicrafts: '🧺',
    food: '🍽️',
    souvenirs: '🎁',
    weavings: '🧵',
    art: '🎨'
  };

  return (
    <div className="group bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-2xl hover:border-blue-300 transition-all duration-300 transform hover:-translate-y-1">
      {/* Product Image */}
      <div
        className="relative h-56 bg-gradient-to-br from-gray-100 to-gray-200 overflow-hidden cursor-pointer"
        onClick={() => onViewDetails && onViewDetails(product)}
        role="button"
        tabIndex={0}
        aria-label={`View details for ${product.name}`}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (onViewDetails) onViewDetails(product);
          }
        }}
      >
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name}
            className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-gray-400">
            <svg className="w-20 h-20 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="text-xs font-medium">No image available</span>
          </div>
        )}
        
        {/* Save for later: a heart in the corner of the photo, like Shopee */}
        {onToggleWishlist && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleWishlist(product);
            }}
            aria-label={isWishlisted ? `Remove ${product.name} from your wishlist` : `Add ${product.name} to your wishlist`}
            aria-pressed={isWishlisted}
            title={isWishlisted ? 'Saved to your wishlist' : 'Add to wishlist'}
            className={`absolute bottom-3 right-3 z-10 flex h-10 w-10 items-center justify-center rounded-full shadow-lg backdrop-blur-sm transition-colors ${
              isWishlisted ? 'bg-red-500 text-white' : 'bg-white/95 text-gray-500 hover:text-red-500'
            }`}
          >
            <svg
              className="h-5 w-5"
              fill={isWishlisted ? 'currentColor' : 'none'}
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
          </button>
        )}

        {/* Category Badge */}
        {product.category && (
          <div className="absolute top-3 right-3 bg-white/95 backdrop-blur-sm text-gray-900 text-xs px-3 py-1.5 rounded-full font-semibold shadow-lg flex items-center gap-1">
            <span>{categoryIcons[product.category] || '🏪'}</span>
            <span className="capitalize">{product.category}</span>
          </div>
        )}

        {/* Stock Badge */}
        {product.stock <= 5 && product.stock > 0 && (
          <div className="absolute top-3 left-3 bg-yellow-500 text-white text-xs px-3 py-1.5 rounded-full font-bold shadow-lg">
            Only {product.stock} left!
          </div>
        )}
        {product.stock === 0 && (
          <div className="absolute top-3 left-3 bg-red-500 text-white text-xs px-3 py-1.5 rounded-full font-bold shadow-lg">
            Sold Out
          </div>
        )}
      </div>

      {/* Product Info */}
      <div className="p-5">
        <button
          type="button"
          onClick={() => onViewDetails && onViewDetails(product)}
          className="text-left w-full font-bold text-lg text-gray-900 mb-2 line-clamp-2 min-h-[3.5rem] group-hover:text-blue-600 transition-colors"
        >
          {product.name}
        </button>

        {reviewSummary && reviewSummary.count > 0 && (
          <div className="flex items-center gap-2 mb-2">
            <StarRating rating={reviewSummary.average} />
            <span className="text-sm font-semibold text-gray-800">
              {reviewSummary.average.toFixed(1)}
            </span>
            <span className="text-xs text-gray-500">({reviewSummary.count})</span>
          </div>
        )}
        
        {/* Seller Badge */}
        {sellerInfo && (
          <div className="flex items-center gap-2 mb-2 pb-2 border-b border-gray-100">
            <div className="w-5 h-5 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
              <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-500">Sold by</p>
              {onViewShop ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onViewShop();
                  }}
                  title={`Visit ${sellerInfo.business_name}`}
                  className="block w-full truncate text-left text-sm font-semibold text-blue-600 underline-offset-2 hover:underline"
                >
                  {sellerInfo.business_name}
                </button>
              ) : (
                <p className="text-sm font-semibold text-blue-600 truncate">{sellerInfo.business_name}</p>
              )}
            </div>
          </div>
        )}
        
        {product.artisan_name && (
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center">
              <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
              </svg>
            </div>
            <div>
              <p className="text-xs text-gray-500">Artisan</p>
              <p className="text-sm text-gray-700 font-medium">
                {product.artisan_name}
              </p>
            </div>
          </div>
        )}

        <p className="text-sm text-gray-600 mb-4 line-clamp-2 min-h-[2.5rem]">
          {product.description || 'Authentic Daet product handcrafted with care'}
        </p>

        {/* Price and Stock Row */}
        <div className="flex justify-between items-end mb-4 pb-4 border-b border-gray-100">
          <div>
            <p className="text-xs text-gray-500 mb-1">Price</p>
            <span className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-blue-700 bg-clip-text text-transparent">
              ₱{Number(product.price || 0).toFixed(2)}
            </span>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500 mb-1">Stock</p>
            <span className={`text-sm font-bold ${product.stock > 5 ? 'text-green-600' : product.stock > 0 ? 'text-yellow-600' : 'text-red-600'}`}>
              {product.stock > 0 ? `${product.stock} available` : 'Out of stock'}
            </span>
          </div>
        </div>

        {/* Buy now + Add to cart */}
        {product.stock > 0 ? (
          <div className="flex gap-2">
            <button
              onClick={() => onAddToCart(product)}
              className="flex-1 min-h-[44px] px-3 rounded-lg text-sm font-bold border-2 border-blue-600 text-blue-600 hover:bg-blue-50 transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap"
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              Add to Cart
            </button>
            <button
              onClick={() => (onBuyNow ? onBuyNow(product) : onAddToCart(product))}
              className="flex-1 min-h-[44px] px-3 rounded-lg text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 shadow-sm transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap"
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Buy Now
            </button>
          </div>
        ) : (
          <button
            disabled
            className="w-full py-3.5 rounded-lg font-bold bg-gray-200 text-gray-400 cursor-not-allowed flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            Out of Stock
          </button>
        )}
      </div>
    </div>
  );
}
