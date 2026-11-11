'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import ProductCard from '@/components/shop/ProductCard';
import Cart from '@/components/shop/Cart';
import ProductDetailsModal from '@/components/shop/ProductDetailsModal';
import AuthModal from '@/components/AuthModal';
import { useDialog } from '@/components/ui/Dialog';
import ShopProfileModal from '@/components/shop/ShopProfileModal';
import ProductOptionsModal from '@/components/shop/ProductOptionsModal';
import { cartLineId, describeSelection, hasOptions } from '@/lib/productOptions';
import { openConversation } from '@/lib/messages';
import { storeBuyNow } from '@/lib/buyNow';
import ShopFooter from '@/components/shop/ShopFooter';

export default function ShopPage() {
  const [products, setProducts] = useState([]);
  const [sellers, setSellers] = useState({});
  const [cart, setCart] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [showCart, setShowCart] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedSellerId, setSelectedSellerId] = useState(null);
  // The product whose options sheet is open, and why it was opened
  const [optionsFor, setOptionsFor] = useState(null);
  const [reviewsByProduct, setReviewsByProduct] = useState({});
  const [reviewableProducts, setReviewableProducts] = useState({});

  const [pendingProductId, setPendingProductId] = useState(null);
  const { showToast, showConfirm, showAlert } = useDialog();

  const confirmSignOut = async () => {
    const confirmed = await showConfirm({
      tone: 'question',
      title: 'Log out?',
      message: 'You will need to sign in again to shop or see your orders. Your cart is kept.',
      confirmLabel: 'Log out',
      cancelLabel: 'Stay signed in',
    });
    if (confirmed) signOut();
  };

  // Links from the dashboard: ?cart=1 opens the cart, ?product=<id> opens that
  // product so a wishlist or "View" button lands on the product itself.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    if (params.get('cart') === '1') setShowCart(true);

    const productId = params.get('product');
    if (productId) setPendingProductId(productId);

    // Tidy the address bar so a refresh does not reopen the cart or the
    // product window again.
    if (params.has('cart') || params.has('product')) {
      params.delete('cart');
      params.delete('product');
      const query = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (query ? `?${query}` : ''));
    }
  }, []);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [inStockOnly, setInStockOnly] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const { user, profile, role, isSuspended, loading: authLoading, signOut } = useAuth();
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
      const parsed = savedCart ? JSON.parse(savedCart) : [];

      // Carts saved before product options existed have no line id; give them
      // one so the rest of the cart code can rely on it.
      setCart(
        (Array.isArray(parsed) ? parsed : []).map((item) => ({
          ...item,
          productId: item.productId || item.id,
          selectedOptions: item.selectedOptions || {},
          lineId: item.lineId || cartLineId(item.productId || item.id, item.selectedOptions),
        }))
      );
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

  // The product list arrives after the page, so wait for it before opening the
  // product asked for in the link.
  useEffect(() => {
    if (!pendingProductId || products.length === 0) return;

    const wanted = products.find((product) => product.id === pendingProductId);
    setPendingProductId(null);

    if (wanted) {
      setSelectedProduct(wanted);
    } else {
      showToast('That product is no longer available.', 'info');
    }
  }, [pendingProductId, products]);

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
            .select('id, business_name, description, created_at')
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
      const columns = 'id, product_id, rating, comment, created_at';
      const read = (select) =>
        supabase.from('shop_reviews').select(select).order('created_at', { ascending: false }).limit(300);

      // The author columns arrive with supabase-product-options.sql; fall back
      // so an older database still shows its reviews.
      let { data, error } = await read(`${columns}, reviewer_name, reviewer_avatar_url`);

      if (error && /reviewer_name|reviewer_avatar_url|column/i.test(error.message || '')) {
        ({ data, error } = await read(columns));
      }

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

    // The author's name and picture are copied onto the review: profiles can
    // only be read by their owner, so other shoppers could never look them up.
    const review = {
      product_id: product.id,
      user_id: user.id,
      rating: value,
      comment: text || null,
    };

    let { error } = await supabase.from('shop_reviews').insert({
      ...review,
      reviewer_name: profile?.full_name || (user.email || '').split('@')[0] || 'Customer',
      reviewer_avatar_url: profile?.avatar_url || null,
    });

    // Database without the author columns yet: save the review itself.
    if (error && /reviewer_name|reviewer_avatar_url/.test(error.message || '')) {
      ({ error } = await supabase.from('shop_reviews').insert(review));
    }

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

  /**
   * Start (or continue) a chat with a shop, then open the customer's inbox
   * where the conversation lives.
   */
  const messageShop = async (seller, productId = null) => {
    if (!user) {
      setShowAuthModal(true);
      return;
    }

    try {
      await openConversation(seller.id, productId);
      window.location.href = '/shop/buyer?tab=messages';
    } catch (error) {
      showAlert(error.message || 'Could not open the chat.');
    }
  };

  /** Shared gate: a shopper must be signed in, active, and the item in stock. */
  const canShop = (product) => {
    if (!user) {
      setShowAuthModal(true);
      return false;
    }

    if (isSuspended) {
      showToast('This account has been suspended. Please contact CONNECT-Daet support.', 'error');
      return false;
    }

    if (!product.stock || product.stock <= 0) {
      showToast('Sorry, this product is out of stock.', 'error');
      return false;
    }

    return true;
  };

  /**
   * Put a chosen variant into the cart. Each combination of product and
   * choices is its own line, so one red and one blue are counted separately.
   */
  const addLineToCart = (product, quantity = 1, selectedOptions = {}) => {
    const lineId = cartLineId(product.id, selectedOptions);
    const stock = Number(product.stock) || 0;

    const existing = cart.find((item) => item.lineId === lineId);
    if (existing && existing.quantity >= stock) {
      showToast(`Cannot add more. Only ${stock} in stock.`, 'error');
      return false;
    }

    setCart((prevCart) => {
      const current = prevCart.find((item) => item.lineId === lineId);

      if (current) {
        return prevCart.map((item) =>
          item.lineId === lineId
            ? { ...item, quantity: Math.min(item.quantity + quantity, stock) }
            : item
        );
      }

      return [
        ...prevCart,
        {
          ...product,
          lineId,
          productId: product.id,
          selectedOptions,
          quantity: Math.min(quantity, stock),
        },
      ];
    });

    return true;
  };

  /**
   * "Add to Cart" on a card. A product with choices opens the options sheet
   * first, exactly as Shopee and Lazada do; a plain product goes straight in.
   */
  const addToCart = (product, quantity = 1) => {
    if (!canShop(product)) return;

    if (hasOptions(product)) {
      setSelectedProduct(null);
      setOptionsFor({ product, intent: 'cart' });
      return;
    }

    if (addLineToCart(product, quantity)) {
      // Adding to the cart keeps the customer on the product list. Only
      // "Buy Now" moves on to checkout; the cart button carries the count.
      showToast(`${product.name} added to your cart.`, 'success');
    }
  };

  const removeFromCart = (lineId) => {
    setCart((prevCart) => prevCart.filter((item) => item.lineId !== lineId));
  };

  const updateQuantity = (lineId, quantity) => {
    const item = cart.find((entry) => entry.lineId === lineId);

    if (!item) return;

    // Never let the quantity buttons empty a line; the bin icon removes it,
    // and that asks first.
    if (quantity < 1) return;

    const maxStock = Number(item.stock) || 0;
    if (quantity > maxStock) {
      showToast(`Only ${maxStock} of ${item.name} in stock.`, 'error');
      return;
    }

    setCart((prevCart) =>
      prevCart.map((entry) => (entry.lineId === lineId ? { ...entry, quantity } : entry))
    );
  };

  /** "Buy Now" always opens the options sheet, where quantity is chosen. */
  const buyNow = (product) => {
    if (!canShop(product)) return;

    setSelectedProduct(null);
    setOptionsFor({ product, intent: 'buy' });
  };

  /**
   * Buy one item now. It is NOT put in the cart and the cart drawer stays
   * shut: the item is handed to the checkout page on its own.
   */
  const goToBuyNowCheckout = (product, quantity, selectedOptions) => {
    if (!user) {
      setShowAuthModal(true);
      return;
    }

    storeBuyNow(user.id, product, quantity, selectedOptions);
    window.location.href = '/shop/checkout?mode=buynow';
  };

  /** What the options sheet hands back. */
  const handleOptionsConfirm = ({ product, quantity, selected, action }) => {
    setOptionsFor(null);

    if (action === 'buy') {
      goToBuyNowCheckout(product, quantity, selected);
      return;
    }

    if (!addLineToCart(product, quantity, selected)) return;

    const summary = describeSelection(selected);
    showToast(`${product.name}${summary ? ` (${summary})` : ''} added to your cart.`, 'success');
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
  
  // Card-level average and count; the modal lists the reviews themselves.
  const reviewSummaries = {};
  Object.keys(reviewsByProduct).forEach((productId) => {
    const rows = reviewsByProduct[productId] || [];
    if (rows.length === 0) return;
    const total = rows.reduce((sum, review) => sum + (Number(review.rating) || 0), 0);
    reviewSummaries[productId] = { average: total / rows.length, count: rows.length };
  });

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredProducts = products
    .filter((p) => {
      const matchesCategory = filter === 'all' || p.category === filter;
      const matchesStock = !inStockOnly || (Number(p.stock) || 0) > 0;
      const sellerName = sellers[p.seller_id]?.business_name || '';
      const matchesSearch =
        normalizedQuery === '' ||
        [p.name, p.description, p.artisan_name, p.category, sellerName]
          .some((value) => String(value || '').toLowerCase().includes(normalizedQuery));
      return matchesCategory && matchesStock && matchesSearch;
    })
    .sort((a, b) => {
      // The chosen order is applied exactly as its label says. Sold-out items
      // are NOT pushed to the end: doing that made "Name: A to Z" look broken
      // when a sold-out product should have come first. Use "In stock only"
      // to hide them instead.
      switch (sortBy) {
        case 'price-asc':
          return (Number(a.price) || 0) - (Number(b.price) || 0);
        case 'price-desc':
          return (Number(b.price) || 0) - (Number(a.price) || 0);
        case 'rating':
          return (
            (reviewSummaries[b.id]?.average || 0) - (reviewSummaries[a.id]?.average || 0) ||
            (reviewSummaries[b.id]?.count || 0) - (reviewSummaries[a.id]?.count || 0)
          );
        case 'name':
          return String(a.name || '').localeCompare(String(b.name || ''));
        default:
          return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      }
    });

  const cartTotal = cart.reduce(
    (sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 0),
    0
  );
  const cartItemCount = cart.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const accountHref =
    role === 'admin'
      ? '/shop/admin'
      : role === 'seller'
      ? '/shop/seller/dashboard'
      : '/shop/buyer';
  const accountLabel =
    role === 'admin' ? 'Admin Panel' : role === 'seller' ? 'Seller Dashboard' : 'My Account';

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
                    onClick={confirmSignOut}
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
                type="search"
                aria-label="Search products"
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

          {/* Result count and sorting live in the sticky bar, so they stay
              reachable while scrolling through a long list of products. */}
          {!loading && (
            <div className="mt-3 flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-gray-600">
                Showing <span className="font-semibold text-gray-900">{filteredProducts.length}</span>{' '}
                {filteredProducts.length === 1 ? 'product' : 'products'}
                {filter !== 'all' && ` in ${categories.find((c) => c.value === filter)?.label || filter}`}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={inStockOnly}
                    onChange={(e) => setInStockOnly(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  In stock only
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <span className="sr-only sm:not-sr-only">Sort by</span>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="min-h-[44px] rounded-lg border-2 border-gray-200 bg-white px-3 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="newest">Newest</option>
                    <option value="price-asc">Price: Low to High</option>
                    <option value="price-desc">Price: High to Low</option>
                    <option value="rating">Top Rated</option>
                    <option value="name">Name: A to Z</option>
                  </select>
                </label>
              </div>
            </div>
          )}
        </div>
      </div>


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
            {(searchQuery || filter !== 'all' || inStockOnly) && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setFilter('all');
                  setInStockOnly(false);
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
                onViewShop={() => setSelectedSellerId(product.seller_id)}
                reviewSummary={reviewSummaries[product.id]}
              />
            ))}
          </div>
        )}
      </main>

      <ShopFooter />

      {/* Cart Sidebar */}
      <Cart
        cart={cart}
        isOpen={showCart}
        onClose={() => setShowCart(false)}
        onUpdateQuantity={updateQuantity}
        onRemoveItem={removeFromCart}
        total={cartTotal}
      />

      {/* Product quick view */}
      <ProductDetailsModal
        product={selectedProduct}
        sellerInfo={selectedProduct ? sellers[selectedProduct.seller_id] : null}
        onViewShop={() => {
          const sellerId = selectedProduct?.seller_id;
          setSelectedProduct(null);
          setSelectedSellerId(sellerId);
        }}
        onMessageShop={(seller) => messageShop(seller, selectedProduct?.id || null)}
        reviews={selectedProduct ? reviewsByProduct[selectedProduct.id] || [] : []}
        canReview={Boolean(selectedProduct && user && reviewableProducts[selectedProduct.id])}
        onSubmitReview={submitProductReview}
        onClose={() => setSelectedProduct(null)}
        onAddToCart={addToCart}
        onBuyNow={buyNow}
      />

      {/* Choose options (Buy Now / products with variants) */}
      <ProductOptionsModal
        product={optionsFor?.product || null}
        intent={optionsFor?.intent || 'cart'}
        onClose={() => setOptionsFor(null)}
        onConfirm={handleOptionsConfirm}
      />

      {/* Shop profile */}
      <ShopProfileModal
        seller={selectedSellerId ? sellers[selectedSellerId] : null}
        products={selectedSellerId ? products.filter((item) => item.seller_id === selectedSellerId) : []}
        reviewSummaries={reviewSummaries}
        onClose={() => setSelectedSellerId(null)}
        onViewProduct={(product) => {
          setSelectedSellerId(null);
          setSelectedProduct(product);
        }}
        onMessageShop={(seller) => messageShop(seller)}
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
