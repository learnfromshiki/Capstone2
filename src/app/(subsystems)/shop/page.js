'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import ProductCard from '@/components/shop/ProductCard';
import Cart from '@/components/shop/Cart';
import ProductDetailsModal from '@/components/shop/ProductDetailsModal';
import AuthModal from '@/components/AuthModal';

export default function ShopPage() {
  const [products, setProducts] = useState([]);
  const [sellers, setSellers] = useState({});
  const [cart, setCart] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [showCart, setShowCart] = useState(false);
  const [checkoutRequest, setCheckoutRequest] = useState(0);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [reviewsByProduct, setReviewsByProduct] = useState({});
  const [reviewableProducts, setReviewableProducts] = useState({});

  // Open the cart when arriving from the buyer dashboard "My Cart" link
  useEffect(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('cart') === '1') {
      setShowCart(true);
    }
  }, []);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const { user, profile, isSuspended, loading: authLoading, signOut } = useAuth();
  const cartKey = user ? `shop_cart:${user.id}` : null;
  const [cartOwner, setCartOwner] = useState(undefined);

  // Old builds shared one "shop_cart" key between every account on the device.
  // Remove it so one customer's cart can never appear in another's session.
  useEffect(() => {
    try {
      localStorage.removeItem('shop_cart');
    } catch (error) {
      console.error('Error clearing the legacy cart:', error);
    }
  }, []);

  // Load the signed-in customer's own cart. Guests get an empty cart because
  // adding to the cart already requires an account.
  useEffect(() => {
    if (authLoading) return;

    if (!user || !cartKey) {
      setCart([]);
      setCartOwner(null);
      return;
    }

    if (cartOwner === cartKey) return;

    try {
      const savedCart = localStorage.getItem(cartKey);
      setCart(savedCart ? JSON.parse(savedCart) : []);
    } catch (error) {
      console.error('Error loading cart:', error);
      setCart([]);
    }

    setCartOwner(cartKey);
  }, [user, authLoading, cartKey, cartOwner]);

  // Save only after the matching cart has been loaded, so a cart from the
  // previous account cannot overwrite the new account's cart.
  useEffect(() => {
    if (!user || !cartKey || cartOwner !== cartKey) return;

    try {
      if (cart.length > 0) {
        localStorage.setItem(cartKey, JSON.stringify(cart));
      } else {
        localStorage.removeItem(cartKey);
      }
    } catch (error) {
      console.error('Error saving cart:', error);
    }
  }, [cart, user, cartKey, cartOwner]);

  useEffect(() => {
    fetchProducts();
    fetchCategories();
    fetchReviews();
  }, []);

  const fetchProducts = async () => {
    try {
      // Check if Supabase client is configured
      if (!supabase) {
        console.error('Supabase client is not initialized. Please check your environment variables.');
        setLoading(false);
        return;
      }

      const { data: productRows, error: productsError } = await supabase
        .from('shop_products')
        .select('*')
        .eq('available', true)
        .order('created_at', { ascending: false });

      if (productsError) throw productsError;

      // Only products from approved, active, non-rejected sellers (plus
      // platform listings with no seller) may appear in the public catalog.
      // RLS enforces this after the hardening SQL is run; this filter also
      // protects the current deployment.
      const loadApprovedSellers = async () => {
        const baseQuery = () =>
          supabase
            .from('shop_sellers')
            .select('id, business_name, description')
            .eq('is_approved', true)
            .eq('is_active', true);

        let result = await baseQuery().eq('is_rejected', false);

        if (result.error && /is_rejected|column .* does not exist/i.test(result.error.message || '')) {
          result = await baseQuery();
        }

        return result;
      };

      const { data: sellerRows, error: sellersError } = await loadApprovedSellers();

      if (sellersError) {
        console.error('Error loading approved sellers:', sellersError.message);
      }

      const sellerMap = {};
      (sellerRows || []).forEach((seller) => {
        sellerMap[seller.id] = seller;
      });

      const visibleProducts = (productRows || []).filter(
        (product) => !product.seller_id || Boolean(sellerMap[product.seller_id])
      );

      setSellers(sellerMap);
      setProducts(visibleProducts);

    } catch (error) {
      console.error('Error fetching products:', error?.message || JSON.stringify(error));
    } finally {
      setLoading(false);
    }
  };

  // Reviews are readable by everyone, so guests see them too and each product
  // card can show the rating its buyers gave.
  const fetchReviews = async () => {
    try {
      const { data, error } = await supabase
        .from('shop_reviews')
        .select('id, product_id, rating, comment, created_at')
        .order('created_at', { ascending: false })
        .limit(300);

      if (error) {
        console.warn('Reviews are unavailable:', error.message);
        return;
      }

      const grouped = {};
      (data || []).forEach((review) => {
        if (!review.product_id) return;
        if (!grouped[review.product_id]) grouped[review.product_id] = [];
        grouped[review.product_id].push(review);
      });

      setReviewsByProduct(grouped);
    } catch (error) {
      console.warn('Reviews are unavailable:', error?.message || error);
    }
  };

  // A product can be reviewed only after a delivered order that contains it,
  // and only once. RLS enforces both; this keeps the form out of reach early.
  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      setReviewableProducts({});
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const [deliveredRes, mineRes] = await Promise.all([
          supabase
            .from('shop_orders')
            .select('id, status, shop_order_items(product_id)')
            .eq('user_id', user.id)
            .eq('status', 'delivered'),
          supabase.from('shop_reviews').select('product_id').eq('user_id', user.id),
        ]);

        if (deliveredRes.error) throw deliveredRes.error;
        if (mineRes.error) throw mineRes.error;
        if (cancelled) return;

        const reviewed = new Set((mineRes.data || []).map((review) => review.product_id));
        const eligible = {};

        (deliveredRes.data || []).forEach((order) => {
          (order.shop_order_items || []).forEach((item) => {
            if (item.product_id && !reviewed.has(item.product_id)) {
              eligible[item.product_id] = true;
            }
          });
        });

        setReviewableProducts(eligible);
      } catch (error) {
        if (!cancelled) {
          console.warn('Could not check review eligibility:', error?.message || error);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  const submitProductReview = async (product, { rating, comment }) => {
    if (!user) {
      setShowAuthModal(true);
      throw new Error('Please sign in to review this product.');
    }

    const value = Number(rating);
    if (!Number.isInteger(value) || value < 1 || value > 5) {
      throw new Error('Please choose a star rating from 1 to 5.');
    }

    const text = (comment || '').trim();
    if (text.length > 1000) {
      throw new Error('Please keep your review under 1,000 characters.');
    }

    if (!reviewableProducts[product.id]) {
      throw new Error('Only delivered orders can be reviewed.');
    }

    const { error } = await supabase.from('shop_reviews').insert({
      product_id: product.id,
      user_id: user.id,
      rating: value,
      comment: text || null,
    });

    if (error) {
      if (error.code === '23505' || /duplicate|unique/i.test(error.message || '')) {
        throw new Error('You have already reviewed this product.');
      }
      throw error;
    }

    setReviewableProducts((previous) => {
      const next = { ...previous };
      delete next[product.id];
      return next;
    });

    await fetchReviews();
  };

  const addToCart = (product, quantity = 1) => {
    // Check if user is logged in
    if (!user) {
      setShowAuthModal(true);
      return;
    }

    if (isSuspended) {
      alert('This account has been suspended. Please contact CONNECT-Daet support.');
      return;
    }

    // Check if product has stock
    if (!product.stock || product.stock <= 0) {
      alert('Sorry, this product is out of stock.');
      return;
    }

    setCart((prevCart) => {
      const existingItem = prevCart.find((item) => item.id === product.id);
      
      if (existingItem) {
        // Check if adding one more would exceed stock
        if (existingItem.quantity >= product.stock) {
          alert(`Cannot add more. Only ${product.stock} in stock.`);
          return prevCart;
        }
        
        return prevCart.map((item) =>
          item.id === product.id
            ? { ...item, quantity: Math.min(item.quantity + quantity, product.stock) }
            : item
        );
      }
      return [...prevCart, { ...product, quantity: Math.min(quantity, product.stock) }];
    });
    
    // Open the cart so the customer sees what was just added
    setShowCart(true);
  };

  const removeFromCart = (productId) => {
    setCart((prevCart) => prevCart.filter((item) => item.id !== productId));
  };

  const updateQuantity = (productId, quantity) => {
    const item = cart.find((entry) => entry.id === productId);

    if (!item) return;

    if (quantity <= 0) {
      removeFromCart(productId);
      return;
    }

    const maxStock = Number(item.stock) || 0;
    if (quantity > maxStock) {
      alert(`Only ${maxStock} of ${item.name} in stock.`);
      return;
    }

    setCart((prevCart) =>
      prevCart.map((entry) =>
        entry.id === productId ? { ...entry, quantity } : entry
      )
    );
  };

  // Buy Now puts the item in the cart, opens the drawer and jumps into checkout
  const buyNow = (product, quantity = 1) => {
    if (!user) {
      setShowAuthModal(true);
      return;
    }

    if (isSuspended) {
      alert('This account has been suspended. Please contact CONNECT-Daet support.');
      return;
    }

    if (!product.stock || product.stock <= 0) {
      alert('Sorry, this product is out of stock.');
      return;
    }

    addToCart(product, quantity);
    setShowCart(true);
    setCheckoutRequest((request) => request + 1);
  };

  const clearCart = () => {
    setCart([]);
  };

  const defaultCategories = [
    { value: 'all', label: 'All Products', icon: '🏪' },
    { value: 'handicrafts', label: 'Handicrafts', icon: '🧺' },
    { value: 'food', label: 'Food', icon: '🍽️' },
    { value: 'souvenirs', label: 'Souvenirs', icon: '🎁' },
    { value: 'weavings', label: 'Weavings', icon: '🧵' },
    { value: 'art', label: 'Art', icon: '🎨' }
  ];

  // Tabs come from shop_categories, so a category added by a seller or the admin
  // shows up here immediately. The built-in list is only the fallback.
  const [categories, setCategories] = useState(defaultCategories);

  const fetchCategories = async () => {
    try {
      const { data, error } = await supabase
        .from('shop_categories')
        .select('name, slug, icon')
        .eq('is_active', true)
        .order('display_order', { ascending: true });

      if (error) {
        console.warn('Category tabs fall back to the built-in list:', error.message);
        return;
      }

      const rows = (data || []).filter((cat) => cat.slug && cat.slug !== 'all');
      if (rows.length === 0) return;

      setCategories([
        { value: 'all', label: 'All Products', icon: '🏪' },
        ...rows.map((cat) => ({ value: cat.slug, label: cat.name, icon: cat.icon || '🏪' }))
      ]);
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  };
  
  const filteredProducts = products.filter(p => {
    const matchesCategory = filter === 'all' || p.category === filter;
    const sellerName = sellers[p.seller_id]?.business_name || '';
    const matchesSearch = searchQuery === '' || 
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.artisan_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      sellerName.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const cartTotal = cart.reduce(
    (sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 0),
    0
  );
  const cartItemCount = cart.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const accountHref =
    profile?.user_type === 'admin'
      ? '/shop/admin'
      : profile?.user_type === 'seller'
      ? '/shop/seller/dashboard'
      : '/shop/buyer';
  const accountLabel =
    profile?.user_type === 'admin'
      ? 'Admin Panel'
      : profile?.user_type === 'seller'
      ? 'Seller Dashboard'
      : 'My Account';

  // Card-level average and count; the modal lists the reviews themselves.
  const reviewSummaries = {};
  Object.keys(reviewsByProduct).forEach((productId) => {
    const rows = reviewsByProduct[productId] || [];
    if (rows.length === 0) return;
    const total = rows.reduce((sum, review) => sum + (Number(review.rating) || 0), 0);
    reviewSummaries[productId] = { average: total / rows.length, count: rows.length };
  });

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Professional Header */}
      <header className="bg-white border-b sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* Logo/Brand */}
            <Link href="/" className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-700 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                </svg>
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-900">Daet Local Shop</h1>
                <p className="text-xs text-gray-500">Authentic Bicol Products</p>
              </div>
            </Link>

            {/* Actions */}
            <div className="flex items-center gap-2 sm:gap-4">
              <Link 
                href="/"
                className="text-gray-600 hover:text-gray-900 font-medium text-sm hidden sm:block"
              >
                Home
              </Link>
              
              {user ? (
                <div className="flex items-center gap-2 sm:gap-3">
                  <Link
                    href={accountHref}
                    aria-label={accountLabel}
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 sm:hidden"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                    </svg>
                  </Link>
                  <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-blue-50 rounded-lg">
                    <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                    </svg>
                    <Link href={accountHref} className="text-sm font-medium text-gray-700 hover:text-blue-600">
                      {accountLabel}
                    </Link>
                  </div>
                  <button
                    onClick={signOut}
                    className="min-h-[44px] px-2 text-sm text-gray-600 hover:text-gray-900 font-medium"
                  >
                    Logout
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowAuthModal(true)}
                  className="min-h-[44px] text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 rounded-lg font-medium transition-colors"
                >
                  Sign In
                </button>
              )}
              
              <button
                onClick={() => setShowCart(!showCart)}
                className="relative bg-blue-600 text-white rounded-lg px-4 py-3 hover:bg-blue-700 transition-all shadow-sm hover:shadow flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                <span className="font-semibold hidden sm:inline">Cart</span>
                {cartItemCount > 0 && (
                  <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full w-6 h-6 flex items-center justify-center font-bold animate-pulse">
                    {cartItemCount}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      </header>

      {isSuspended && (
        <div role="alert" className="border-b-2 border-red-200 bg-red-50 px-4 py-3 text-center text-sm font-semibold text-red-800">
          This account is suspended. You can browse, but you cannot add items to the cart or place orders.
        </div>
      )}

      {/* Search and Filter Bar */}
      <div className="bg-white border-b sticky top-16 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          {/* Search Bar */}
          <div className="mb-4">
            <div className="relative max-w-2xl mx-auto">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search for products, sellers, artisans, categories..."
                className="w-full px-6 py-3.5 pl-12 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all text-sm"
              />
              <svg className="w-5 h-5 text-gray-400 absolute left-4 top-1/2 transform -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>
          
          {/* Category Tabs */}
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {categories.map((category) => (
              <button
                key={category.value}
                onClick={() => setFilter(category.value)}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-lg whitespace-nowrap font-medium transition-all ${
                  filter === category.value
                    ? 'bg-blue-600 text-white shadow-md scale-105'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <span>{category.icon}</span>
                <span className="text-sm">{category.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Results Count */}
      {!loading && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <p className="text-sm text-gray-600">
            Showing <span className="font-semibold text-gray-900">{filteredProducts.length}</span> {filteredProducts.length === 1 ? 'product' : 'products'}
            {filter !== 'all' && ` in ${categories.find(c => c.value === filter)?.label}`}
          </p>
        </div>
      )}

      {/* Products Grid */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
        {loading ? (
          <div className="flex flex-col justify-center items-center h-96">
            <div className="relative">
              <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                </svg>
              </div>
            </div>
            <p className="mt-4 text-gray-600 font-medium">Loading products...</p>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl shadow-sm">
            <div className="w-24 h-24 mx-auto mb-6 bg-gray-100 rounded-full flex items-center justify-center">
              <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">No products found</h3>
            <p className="text-gray-500 mb-6">
              {searchQuery ? `We couldn't find any products matching "${searchQuery}"` : 'No products available in this category'}
            </p>
            {(searchQuery || filter !== 'all') && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setFilter('all');
                }}
                className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Clear all filters
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onAddToCart={addToCart}
                onBuyNow={buyNow}
                onViewDetails={setSelectedProduct}
                sellerInfo={sellers[product.seller_id]}
                reviewSummary={reviewSummaries[product.id]}
              />
            ))}
          </div>
        )}
      </main>

      {/* Cart Sidebar */}
      <Cart
        cart={cart}
        isOpen={showCart}
        checkoutRequest={checkoutRequest}
        onClose={() => setShowCart(false)}
        onUpdateQuantity={updateQuantity}
        onRemoveItem={removeFromCart}
        onClearCart={clearCart}
        onOrderPlaced={fetchProducts}
        onRequireAuth={() => {
          setShowCart(false);
          setShowAuthModal(true);
        }}
        total={cartTotal}
      />

      {/* Product quick view */}
      <ProductDetailsModal
        product={selectedProduct}
        sellerInfo={selectedProduct ? sellers[selectedProduct.seller_id] : null}
        reviews={selectedProduct ? reviewsByProduct[selectedProduct.id] || [] : []}
        canReview={Boolean(selectedProduct && user && reviewableProducts[selectedProduct.id])}
        onSubmitReview={submitProductReview}
        onClose={() => setSelectedProduct(null)}
        onAddToCart={addToCart}
        onBuyNow={buyNow}
      />

      {/* Auth Modal */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        mode="login"
      />
    </div>
  );
}
