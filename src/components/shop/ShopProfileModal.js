'use client';

import { useEffect, useMemo, useState } from 'react';
import StarRating from './StarRating';
import Img from '@/components/ui/Img';

const SORTS = [
  { value: 'popular', label: 'Popular' },
  { value: 'latest', label: 'Latest' },
  { value: 'rating', label: 'Top Rated' },
];

/**
 * The public page of one shop: who they are and everything they sell, with a
 * search box, categories and sorting inside the shop (like a Shopee shop).
 * Opened from the "Sold by" name on a product card or in the product window.
 */
export default function ShopProfileModal({
  seller,
  products = [],
  reviewSummaries = {},
  categories = [],
  onClose,
  onViewProduct,
  onMessageShop,
}) {
  const [tab, setTab] = useState('products');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [sort, setSort] = useState('popular');
  // Price sorts low to high first; tapping Price again flips it.
  const [priceDirection, setPriceDirection] = useState('asc');

  // A different shop starts fresh.
  const sellerId = seller?.id;
  useEffect(() => {
    setTab('products');
    setQuery('');
    setCategory('all');
    setSort('popular');
    setPriceDirection('asc');
  }, [sellerId]);

  // Escape closes the shop window
  useEffect(() => {
    if (!seller) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [seller, onClose]);

  // The categories this shop actually sells in, with their names and icons.
  const shopCategories = useMemo(() => {
    const labels = new Map(categories.map((entry) => [entry.value, entry]));
    const counts = new Map();
    products.forEach((product) => {
      if (!product.category) return;
      counts.set(product.category, (counts.get(product.category) || 0) + 1);
    });
    return Array.from(counts.entries()).map(([value, count]) => ({
      value,
      count,
      label: labels.get(value)?.label || value.charAt(0).toUpperCase() + value.slice(1),
      icon: labels.get(value)?.icon || '🏷️',
    }));
  }, [products, categories]);

  const visibleProducts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const summaryOf = (product) => reviewSummaries[product.id] || { average: 0, count: 0 };

    const matches = products.filter((product) => {
      if (category !== 'all' && product.category !== category) return false;
      if (!needle) return true;
      return [product.name, product.description, product.artisan_name]
        .filter(Boolean)
        .some((text) => String(text).toLowerCase().includes(needle));
    });

    const inStockFirst = (a, b) =>
      Number((Number(b.stock) || 0) > 0) - Number((Number(a.stock) || 0) > 0);
    const newest = (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0);

    return [...matches].sort((a, b) => {
      if (sort === 'price') {
        const difference = (Number(a.price) || 0) - (Number(b.price) || 0);
        return priceDirection === 'asc' ? difference : -difference;
      }
      if (sort === 'latest') return newest(a, b);
      if (sort === 'rating') {
        return (
          summaryOf(b).average - summaryOf(a).average ||
          summaryOf(b).count - summaryOf(a).count ||
          newest(a, b)
        );
      }
      // Popular: available first, then the most reviewed and best rated.
      return (
        inStockFirst(a, b) ||
        summaryOf(b).count - summaryOf(a).count ||
        summaryOf(b).average - summaryOf(a).average ||
        newest(a, b)
      );
    });
  }, [products, reviewSummaries, query, category, sort, priceDirection]);

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

  const choosePrice = () => {
    if (sort === 'price') {
      setPriceDirection((direction) => (direction === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort('price');
      setPriceDirection('asc');
    }
  };

  const searching = query.trim().length > 0;

  return (
    <div className="modal-backdrop fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${seller.business_name} shop profile`}
        // A steady height, so the window does not jump as search results change
        className="flex h-[92vh] max-h-[860px] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        {/* Shop header: search, identity, actions */}
        <div className="flex-shrink-0 bg-gradient-to-r from-blue-600 to-blue-700 px-4 pb-4 pt-3 text-white sm:px-6">
          <div className="flex items-center gap-2">
            <label className="relative flex-1">
              <span className="sr-only">Search in this shop</span>
              <svg
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/70"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
              </svg>
              <input
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setTab('products');
                }}
                placeholder="Search in shop"
                className="h-11 w-full rounded-full border border-white/30 bg-white/15 pl-9 pr-4 text-sm text-white placeholder-white/70 outline-none focus:border-white focus:bg-white/25"
              />
            </label>
            <button
              onClick={onClose}
              aria-label="Close shop profile"
              className="flex min-h-[44px] min-w-[44px] flex-shrink-0 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/20 hover:text-white"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="mt-4 flex items-center gap-3">
            {seller.logo_url ? (
              <Img
                src={seller.logo_url}
                alt={`${seller.business_name} logo`}
                width={128}
                className="h-14 w-14 flex-shrink-0 rounded-full border-2 border-white/60 bg-white object-cover"
              />
            ) : (
              <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-white/20 text-2xl font-bold">
                {(seller.business_name || '?').charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-xl font-bold">{seller.business_name}</h2>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-blue-100">
                <span className="flex items-center gap-1">
                  <span className="text-yellow-300">★</span>
                  {shopRating ? shopRating.toFixed(1) : '—'}
                </span>
                <span aria-hidden="true">|</span>
                <span>
                  {products.length} {products.length === 1 ? 'product' : 'products'}
                </span>
                <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold">Verified Seller</span>
              </div>
            </div>
            {onMessageShop && (
              <button
                type="button"
                onClick={() => onMessageShop(seller)}
                className="min-h-[40px] flex-shrink-0 rounded-full border border-white/70 px-4 text-sm font-bold text-white transition-colors hover:bg-white hover:text-blue-700"
              >
                💬 Chat
              </button>
            )}
          </div>
        </div>

        {/* Shop | Products */}
        <div className="flex flex-shrink-0 border-b border-gray-200 bg-white" role="tablist">
          {[
            { value: 'shop', label: 'Shop' },
            { value: 'products', label: 'Products' },
          ].map((entry) => (
            <button
              key={entry.value}
              type="button"
              role="tab"
              aria-selected={tab === entry.value}
              onClick={() => setTab(entry.value)}
              className={`min-h-[48px] flex-1 border-b-2 text-sm font-semibold transition-colors ${
                tab === entry.value
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === 'shop' && (
            <div className="space-y-6 p-6">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-xl bg-gray-50 p-3">
                  <p className="text-xl font-bold text-gray-900">{products.length}</p>
                  <p className="text-xs text-gray-500">{products.length === 1 ? 'Product' : 'Products'}</p>
                </div>
                <div className="rounded-xl bg-gray-50 p-3">
                  <p className="text-xl font-bold text-gray-900">{inStock.length}</p>
                  <p className="text-xs text-gray-500">In stock</p>
                </div>
                <div className="rounded-xl bg-gray-50 p-3">
                  <p className="text-xl font-bold text-gray-900">{shopRating ? shopRating.toFixed(1) : '—'}</p>
                  <p className="text-xs text-gray-500">
                    {reviewCount ? `${reviewCount} ${reviewCount === 1 ? 'review' : 'reviews'}` : 'No reviews yet'}
                  </p>
                </div>
              </div>

              <div>
                <h3 className="mb-1 text-sm font-bold text-gray-900">About this shop</h3>
                <p className="whitespace-pre-line text-sm text-gray-600">
                  {seller.description || 'This shop has not written a description yet.'}
                </p>
                {memberSince && <p className="mt-2 text-xs text-gray-500">Selling on CONNECT-Daet since {memberSince}</p>}
              </div>

              {shopCategories.length > 0 && (
                <div>
                  <h3 className="mb-2 text-sm font-bold text-gray-900">Categories</h3>
                  <div className="flex flex-wrap gap-2">
                    {shopCategories.map((entry) => (
                      <button
                        key={entry.value}
                        type="button"
                        onClick={() => {
                          setCategory(entry.value);
                          setTab('products');
                        }}
                        className="min-h-[40px] rounded-full border border-gray-200 px-3 text-sm text-gray-700 hover:border-blue-300 hover:bg-blue-50"
                      >
                        {entry.icon} {entry.label} <span className="text-gray-400">({entry.count})</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'products' && (
            <div>
              {/* Sort bar */}
              <div className="sticky top-0 z-10 flex border-b border-gray-100 bg-white text-sm">
                {SORTS.map((entry) => (
                  <button
                    key={entry.value}
                    type="button"
                    onClick={() => setSort(entry.value)}
                    aria-pressed={sort === entry.value}
                    className={`min-h-[44px] flex-1 font-medium transition-colors ${
                      sort === entry.value ? 'text-blue-600' : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    {entry.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={choosePrice}
                  aria-pressed={sort === 'price'}
                  aria-label={`Sort by price, ${sort === 'price' && priceDirection === 'desc' ? 'high to low' : 'low to high'}`}
                  className={`flex min-h-[44px] flex-1 items-center justify-center gap-1 font-medium transition-colors ${
                    sort === 'price' ? 'text-blue-600' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Price
                  <span aria-hidden="true" className="flex flex-col text-[9px] leading-[9px]">
                    <span className={sort === 'price' && priceDirection === 'asc' ? 'text-blue-600' : 'text-gray-300'}>▲</span>
                    <span className={sort === 'price' && priceDirection === 'desc' ? 'text-blue-600' : 'text-gray-300'}>▼</span>
                  </span>
                </button>
              </div>

              {/* Categories this shop sells in */}
              {shopCategories.length > 1 && (
                <div className="flex gap-2 overflow-x-auto px-4 pt-3 sm:px-6">
                  {[{ value: 'all', label: 'All', icon: '🏪', count: products.length }, ...shopCategories].map((entry) => (
                    <button
                      key={entry.value}
                      type="button"
                      onClick={() => setCategory(entry.value)}
                      aria-pressed={category === entry.value}
                      className={`min-h-[36px] flex-shrink-0 rounded-full border px-3 text-xs font-medium transition-colors ${
                        category === entry.value
                          ? 'border-blue-600 bg-blue-600 text-white'
                          : 'border-gray-200 bg-white text-gray-700 hover:border-blue-300'
                      }`}
                    >
                      {entry.icon} {entry.label} ({entry.count})
                    </button>
                  ))}
                </div>
              )}

              <div className="p-4 sm:p-6">
                {(searching || category !== 'all') && (
                  <p className="mb-3 text-sm text-gray-600">
                    {visibleProducts.length} {visibleProducts.length === 1 ? 'result' : 'results'}
                    {searching && <> for &ldquo;{query.trim()}&rdquo;</>}
                    {(searching || category !== 'all') && (
                      <button
                        type="button"
                        onClick={() => {
                          setQuery('');
                          setCategory('all');
                        }}
                        className="ml-2 font-semibold text-blue-600 hover:underline"
                      >
                        Clear
                      </button>
                    )}
                  </p>
                )}

                {products.length === 0 ? (
                  <p className="py-10 text-center text-sm text-gray-500">This shop has no products listed yet.</p>
                ) : visibleProducts.length === 0 ? (
                  <div className="py-10 text-center">
                    <p className="text-3xl" aria-hidden="true">🔍</p>
                    <p className="mt-2 text-sm text-gray-600">
                      No products in {seller.business_name} match{searching ? <> &ldquo;{query.trim()}&rdquo;</> : ' this category'}.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
                    {visibleProducts.map((product) => {
                      const summary = reviewSummaries[product.id];
                      const stock = Number(product.stock) || 0;

                      return (
                        <button
                          key={product.id}
                          type="button"
                          onClick={() => onViewProduct(product)}
                          className="flex flex-col overflow-hidden rounded-xl border border-gray-100 bg-white text-left shadow-sm transition-shadow hover:shadow-md"
                        >
                          <div className="relative aspect-square w-full bg-gray-100">
                            {product.image_url ? (
                              <Img
                                src={product.image_url}
                                alt={product.name}
                                sizes="(min-width: 640px) 240px, 50vw"
                                className="absolute inset-0 h-full w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-full items-center justify-center text-xs text-gray-400">No image</div>
                            )}
                            {stock === 0 && (
                              <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm font-bold text-white">
                                Sold out
                              </span>
                            )}
                          </div>
                          <div className="flex flex-1 flex-col p-3">
                            <p className="line-clamp-2 min-h-[2.5rem] text-sm text-gray-900">{product.name}</p>
                            <p className="mt-1 text-lg font-bold text-blue-600">₱{Number(product.price).toFixed(2)}</p>
                            <div className="mt-auto flex items-center justify-between gap-2 pt-1 text-xs text-gray-500">
                              {summary ? (
                                <span className="flex items-center gap-1">
                                  <StarRating rating={summary.average} />
                                  <span>({summary.count})</span>
                                </span>
                              ) : (
                                <span>No reviews</span>
                              )}
                              {stock > 0 && <span>{stock} left</span>}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
