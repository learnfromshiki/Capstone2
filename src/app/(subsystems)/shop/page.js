'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import ProductCard from '@/components/shop/ProductCard';
import Cart from '@/components/shop/Cart';
import ProductDetailsModal from '@/components/shop/ProductDetailsModal';
import AuthModal from '@/components/AuthModal';
import { useDialog } from '@/components/ui/Dialog';
import NotificationCenter from '@/components/ui/NotificationCenter';
import Avatar from '@/components/ui/Avatar';
import { uploadPhotos } from '@/lib/attachments';
import ShopProfileModal from '@/components/shop/ShopProfileModal';
import ProductOptionsModal from '@/components/shop/ProductOptionsModal';
import { cartLineId, describeSelection, hasOptions } from '@/lib/productOptions';
import { countUnread, openConversation } from '@/lib/messages';
import NavBadge from '@/components/ui/NavBadge';
import useLiveBadges from '@/lib/useLiveBadges';
import { storeBuyNow } from '@/lib/buyNow';
import ShopFooter from '@/components/shop/ShopFooter';
import Img from '@/components/ui/Img';
import ReportDialog from '@/components/shop/ReportDialog';
import { flushCart, loadCart, readLocalCart, saveCart } from '@/lib/cart';
import { dashboardPathForRole, returnPathForRole } from '@/lib/roles';
import { listShippingRates } from '@/lib/shipping';
import { WISHLIST_EVENT, readWishlist, toggleWishlist } from '@/lib/wishlist';
import {
  clearRecentlyViewed,
  fetchFollowerCounts,
  fetchMyFollows,
  fetchSoldCounts,
  readRecentlyViewed,
  rememberViewed,
  setFollowing,
} from '@/lib/shopFeatures';

// Keep a price box to digits and at most one decimal point.
const cleanPrice = (value) => {
  const digits = String(value).replace(/[^\d.]/g, '');
  const dot = digits.indexOf('.');
  return dot === -1 ? digits : digits.slice(0, dot + 1) + digits.slice(dot + 1).replace(/\./g, '');
};

export default function ShopPage() {
  const [products, setProducts] = useState([]);
  const [sellers, setSellers] = useState({});
  const [cart, setCart] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [showCart, setShowCart] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedSellerId, setSelectedSellerId] = useState(null);
  // Unread replies from shops, for the badge on the messages icon
  const [unreadMessages, setUnreadMessages] = useState(0);
  // The product whose options sheet is open, and why it was opened
  const [optionsFor, setOptionsFor] = useState(null);
  const [reviewsByProduct, setReviewsByProduct] = useState({});
  const [ratingSummaries, setRatingSummaries] = useState({});
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
  // product so a shared link or "View" button lands on the product itself.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    if (params.get('cart') === '1') setShowCart(true);

    const productId = params.get('product');
    if (productId) setPendingProductId(productId);

    // ?category=<value> comes from the category tiles on the landing page.
    const category = params.get('category');
    if (category) setFilter(category);

    // ?login=1 opens the shop's sign-in window. Emails and the old seller
    // login page send shop owners here, so everyone signs in the same way.
    if (params.get('login') === '1') setLoginRequested(true);
    // ?next=<path>: where to go once signed in (an order link from an email).
    if (params.get('next')) setLoginNext(params.get('next'));

    // Tidy the address bar so a refresh does not reopen the cart or the
    // product window again.
    if (params.has('cart') || params.has('product') || params.has('category') || params.has('login') || params.has('next')) {
      params.delete('cart');
      params.delete('product');
      params.delete('category');
      params.delete('login');
      params.delete('next');
      const query = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (query ? `?${query}` : ''));
    }
  }, []);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [inStockOnly, setInStockOnly] = useState(false);
  // Price range filter (empty = no limit)
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  // Shopee-style extras: units sold, followers, likes, history
  const [soldCounts, setSoldCounts] = useState({});
  const [followerCounts, setFollowerCounts] = useState({});
  const [myFollows, setMyFollows] = useState(() => new Set());
  const [likedIds, setLikedIds] = useState([]);
  const [recentIds, setRecentIds] = useState([]);
  const [freeShippingThreshold, setFreeShippingThreshold] = useState(null);
  // What is being reported (a product or a shop), while the report form is open
  const [reportTarget, setReportTarget] = useState(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [loginRequested, setLoginRequested] = useState(false);
  const [loginNext, setLoginNext] = useState(null);
  const { user, profile, role, isSuspended, loading: authLoading, signOut } = useAuth();

  // Answer ?login=1 once we know who is here: someone already signed in as a
  // shop or admin goes to their dashboard, anyone else gets the sign-in window.
  useEffect(() => {
    if (!loginRequested || authLoading) return;
    setLoginRequested(false);
    if (!user) {
      setShowAuthModal(true);
      return;
    }
    // Already signed in: go straight to where the link was pointing.
    const back = returnPathForRole(loginNext, role || 'customer');
    if (back) {
      window.location.href = back;
    } else if (role === 'seller' || role === 'admin') {
      window.location.href = dashboardPathForRole(role);
    }
  }, [loginRequested, authLoading, user, role, loginNext]);

  // Units sold, followers and the free-delivery threshold:
  // public figures, loaded once with the page.
  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchSoldCounts(), fetchFollowerCounts()]).then(([sold, followers]) => {
      if (cancelled) return;
      setSoldCounts(sold);
      setFollowerCounts(followers);
    });
    listShippingRates()
      .then(({ rates }) => {
        if (cancelled) return;
        const active = (rates || []).filter((rate) => rate.is_active !== false);
        const daet =
          active.find((rate) => /^daet$/i.test(rate.city || '')) ||
          active.find((rate) => /camarines norte/i.test(rate.province || '') && !rate.city) ||
          active.find((rate) => !rate.province && !rate.city);
        setFreeShippingThreshold(Number(daet?.free_threshold) > 0 ? Number(daet.free_threshold) : null);
      })
      .catch(() => {});
    setRecentIds(readRecentlyViewed());
    return () => {
      cancelled = true;
    };
  }, []);

  // The shops this account follows, and its liked products (kept in this
  // browser, per account, and shared with the My Account page).
  useEffect(() => {
    let cancelled = false;
    fetchMyFollows(user?.id).then((follows) => {
      if (!cancelled) setMyFollows(follows);
    });
    setLikedIds(readWishlist(user?.id));
    const onWishlist = (event) => {
      if (event.detail?.userId === user?.id) setLikedIds(event.detail.ids || []);
    };
    window.addEventListener(WISHLIST_EVENT, onWishlist);
    return () => {
      cancelled = true;
      window.removeEventListener(WISHLIST_EVENT, onWishlist);
    };
  }, [user?.id]);

  // Opening a product adds it to "Recently viewed".
  useEffect(() => {
    if (selectedProduct?.id) setRecentIds(rememberViewed(selectedProduct.id));
  }, [selectedProduct?.id]);

  const toggleLike = (product) => {
    if (!user) {
      setShowAuthModal(true);
      return;
    }
    const { ids, saved } = toggleWishlist(user.id, product.id);
    setLikedIds(ids);
    showToast(saved ? 'Added to your Likes' : 'Removed from your Likes', 'success');
  };

  const openReport = (target) => {
    if (!user) {
      setShowAuthModal(true);
      return;
    }
    setReportTarget(target);
  };

  const toggleFollow = async (seller) => {
    if (!user) {
      setShowAuthModal(true);
      return;
    }
    const follow = !myFollows.has(seller.id);
    // Show it at once; undo if the database says no.
    const apply = (on) => {
      setMyFollows((current) => {
        const next = new Set(current);
        if (on) next.add(seller.id);
        else next.delete(seller.id);
        return next;
      });
      setFollowerCounts((counts) => ({
        ...counts,
        [seller.id]: Math.max(0, (counts[seller.id] || 0) + (on ? 1 : -1)),
      }));
    };
    apply(follow);
    try {
      await setFollowing(user.id, seller.id, follow);
      showToast(follow ? `You are now following ${seller.business_name}` : `Unfollowed ${seller.business_name}`, 'success');
    } catch (error) {
      apply(!follow);
      showToast(error.message || 'Could not update. Please try again.', 'error');
    }
  };
  const cartKey = user ? `shop_cart:${user.id}` : null;
  const [cartOwner, setCartOwner] = useState(undefined);
  // The cart as last loaded from / sent to the database, so it is not re-sent.
  const lastSavedCartRef = useRef('[]');
  const activeCartKeyRef = useRef(null);

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
      activeCartKeyRef.current = null;
      setCart([]);
      setCartOwner(null);
      return;
    }

    if (cartOwner === cartKey) return;

    // Show this browser's copy at once, then replace it with the cart saved
    // in the database, which is the same on every device.
    const local = readLocalCart(user.id);
    lastSavedCartRef.current = JSON.stringify(local);
    setCart(local);
    setCartOwner(cartKey);

    const loadingFor = cartKey;
    activeCartKeyRef.current = cartKey;
    loadCart(user.id).then((saved) => {
      // Another account signed in meanwhile: this cart is not theirs.
      if (activeCartKeyRef.current !== loadingFor) return;
      lastSavedCartRef.current = JSON.stringify(saved);
      setCart(saved);
    });
  }, [user, authLoading, cartKey, cartOwner]);

  // Save only after the matching cart has been loaded, so a cart from the
  // previous account cannot overwrite the new account's cart. What was just
  // loaded is not sent back.
  useEffect(() => {
    if (!user || !cartKey || cartOwner !== cartKey) return;

    const serialized = JSON.stringify(cart);
    if (serialized === lastSavedCartRef.current) return;
    lastSavedCartRef.current = serialized;
    saveCart(user.id, cart);
  }, [cart, user, cartKey, cartOwner]);

  // A change made just before leaving the page is still sent.
  useEffect(() => {
    if (!user) return undefined;
    const flush = () => {
      flushCart(user.id);
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [user]);

  useEffect(() => {
    fetchProducts();
    fetchCategories();
    fetchRatingSummaries();
  }, []);

  // A product's reviews load when its window opens.
  useEffect(() => {
    if (selectedProduct?.id) fetchReviews(selectedProduct.id);
    // fetchReviews only reads and stores; the product id is what matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProduct?.id]);

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
  }, [pendingProductId, products, showToast]);

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
            .select('id, business_name, description, created_at, logo_url')
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

  // Every product's average and count, from the database in one call. Loading
  // reviews themselves for this would stop at some limit, and products past
  // it would lose their rating; the reviews are loaded per product instead.
  const fetchRatingSummaries = async () => {
    const { data, error } = await supabase.rpc('product_review_summaries');
    if (error) {
      console.warn('Ratings are unavailable:', error.message);
      return;
    }
    setRatingSummaries(
      Object.fromEntries(
        (data || []).map((row) => [row.product_id, { average: Number(row.average) || 0, count: Number(row.review_count) || 0 }])
      )
    );
  };

  // The reviews of one product, read when its window opens. Reviews are
  // readable by everyone, so guests see them too.
  const fetchReviews = async (productId) => {
    if (!productId) return;
    try {
      const columns = 'id, product_id, rating, comment, created_at';
      const read = (select) =>
        supabase
          .from('shop_reviews')
          .select(select)
          .eq('product_id', productId)
          .order('created_at', { ascending: false })
          .limit(100);

      // The author columns arrive with supabase-product-options.sql; fall back
      // so an older database still shows its reviews.
      let { data, error } = await read(
        `${columns}, reviewer_name, reviewer_avatar_url, photos, seller_reply, seller_reply_at, is_hidden`
      );

      // Shop replies and moderation arrive with supabase-returns-reviews.sql,
      // photos with supabase-notifications-payments.sql and the author
      // columns with supabase-product-options.sql; step back one at a time so
      // an older database still shows its reviews.
      if (error && /column/i.test(error.message || '')) {
        ({ data, error } = await read(`${columns}, reviewer_name, reviewer_avatar_url, photos`));
      }
      if (error && /photos|column/i.test(error.message || '')) {
        ({ data, error } = await read(`${columns}, reviewer_name, reviewer_avatar_url`));
      }

      if (error && /reviewer_name|reviewer_avatar_url|column/i.test(error.message || '')) {
        ({ data, error } = await read(columns));
      }

      if (error) {
        console.warn('Reviews are unavailable:', error.message);
        return;
      }

      // A review the admin hid stays out of the shop for everyone, even the
      // people the database still lets read it (its writer, the shop).
      const visible = (data || []).filter((review) => !review.is_hidden);
      setReviewsByProduct((current) => ({ ...current, [productId]: visible }));
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

  const submitProductReview = async (product, { rating, comment, photos = [] }) => {
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
    // Photos go up first: a failed upload should not leave a half-written review.
    const photoUrls = photos.length > 0 ? await uploadPhotos(photos, 'review') : [];

    const review = {
      product_id: product.id,
      user_id: user.id,
      rating: value,
      comment: text || null,
    };

    const author = {
      reviewer_name: profile?.full_name || (user.email || '').split('@')[0] || 'Customer',
      reviewer_avatar_url: profile?.avatar_url || null,
    };

    let { error } = await supabase
      .from('shop_reviews')
      .insert({ ...review, ...author, photos: photoUrls });

    // Database without the photo column, then without the author columns.
    if (error && /photos/.test(error.message || '')) {
      ({ error } = await supabase.from('shop_reviews').insert({ ...review, ...author }));
    }

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

    await Promise.all([fetchReviews(product.id), fetchRatingSummaries()]);
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

  // Live counts while browsing: a shopper's unread replies, and for a seller
  // or admin, what is waiting in their dashboard.
  const badgeAudience = role === 'admin' ? 'admin' : role === 'seller' ? 'seller' : 'customer';
  const { counts: liveCounts } = useLiveBadges(badgeAudience, { enabled: Boolean(user?.id) && !authLoading });

  useEffect(() => {
    if (badgeAudience === 'customer' && typeof liveCounts?.messages === 'number') {
      setUnreadMessages(liveCounts.messages);
    }
  }, [badgeAudience, liveCounts?.messages]);

  const accountBadge = !liveCounts
    ? 0
    : badgeAudience === 'admin'
      ? (Number(liveCounts.pending_sellers) || 0) + (Number(liveCounts.orders_to_handle) || 0)
      : badgeAudience === 'seller'
        ? (Number(liveCounts.orders_new) || 0) + (Number(liveCounts.orders_to_ship) || 0) + (Number(liveCounts.messages) || 0)
        : (Number(liveCounts.order_updates) || 0) + (Number(liveCounts.to_review) || 0);
  const accountBadgeLabel =
    badgeAudience === 'customer' ? 'order updates and items to review' : 'things waiting in your dashboard';

  // Keep the badge on the messages icon honest while the shopper browses.
  useEffect(() => {
    if (!user?.id || role === 'admin' || role === 'seller') {
      setUnreadMessages(0);
      return undefined;
    }

    let cancelled = false;
    const refresh = () => {
      countUnread('buyer').then((count) => {
        if (!cancelled) setUnreadMessages(count);
      });
    };

    refresh();
    const timer = setInterval(refresh, 30000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [user?.id, role]);

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
   * The cart lives in localStorage, so its prices and stock are whatever they
   * were when the item was added. Once the live catalog has loaded, copy the
   * current price, stock, name and photo onto every line. A product that is
   * no longer listed shows as sold out, and a quantity above what is left is
   * trimmed, so the cart never promises more than checkout will accept.
   */
  useEffect(() => {
    if (loading || !cartKey || cartOwner !== cartKey) return;

    const live = new Map(products.map((product) => [product.id, product]));

    setCart((prevCart) => {
      let changed = false;
      const used = new Map();

      const next = prevCart.map((item) => {
        const productId = item.productId || item.id;
        const product = live.get(productId);
        const stock = product ? Number(product.stock) || 0 : 0;
        const alreadyUsed = used.get(productId) || 0;
        const quantity = Math.max(1, Math.min(Number(item.quantity) || 1, Math.max(stock - alreadyUsed, 1)));
        used.set(productId, alreadyUsed + quantity);

        const updated = product
          ? {
              ...item,
              name: product.name,
              price: product.price,
              stock,
              image_url: product.image_url,
              seller_id: product.seller_id,
              quantity,
            }
          : { ...item, stock: 0 };

        if (
          updated.price !== item.price ||
          updated.stock !== item.stock ||
          updated.quantity !== item.quantity ||
          updated.name !== item.name ||
          updated.image_url !== item.image_url
        ) {
          changed = true;
        }

        return updated;
      });

      return changed ? next : prevCart;
    });
  }, [products, loading, cartKey, cartOwner]);

  /** Units of one product already in the cart, across every colour/size. */
  const unitsInCart = (productId, exceptLineId = null) =>
    cart
      .filter((item) => (item.productId || item.id) === productId && item.lineId !== exceptLineId)
      .reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);

  /**
   * Put a chosen variant into the cart. Each combination of product and
   * choices is its own line, so one red and one blue are counted separately,
   * but they share the product's one stock count.
   */
  const addLineToCart = (product, quantity = 1, selectedOptions = {}) => {
    const lineId = cartLineId(product.id, selectedOptions);
    const stock = Number(product.stock) || 0;
    const room = stock - unitsInCart(product.id);

    if (room <= 0) {
      showToast(`Cannot add more. Only ${stock} in stock, and they are all in your cart.`, 'error');
      return false;
    }

    const adding = Math.min(Math.max(1, Number(quantity) || 1), room);
    if (adding < quantity) {
      showToast(`Only ${room} more could be added. ${stock} in stock.`, 'info');
    }

    setCart((prevCart) => {
      const current = prevCart.find((item) => item.lineId === lineId);

      if (current) {
        return prevCart.map((item) =>
          item.lineId === lineId
            ? { ...item, price: product.price, stock, quantity: item.quantity + adding }
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
          quantity: adding,
        },
      ];
    });

    return true;
  };

  /**
   * "Add to Cart" on a card always opens the options sheet first, exactly as
   * Shopee and Lazada do: nothing lands in the cart until the shopper has
   * actually chosen how many, and which colour or size, rather than a silent
   * "one of the default" the moment the button is tapped.
   */
  const addToCartFromCard = (product) => {
    if (!canShop(product)) return;

    setSelectedProduct(null);
    setOptionsFor({ product, intent: 'cart' });
  };

  /**
   * "Add to Cart" from the product window, where the quantity has already
   * been picked. A product with choices still goes through the sheet.
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

    // Other colours/sizes of the same product use up the same stock.
    const maxStock = (Number(item.stock) || 0) - unitsInCart(item.productId || item.id, lineId);
    if (quantity > maxStock) {
      showToast(
        maxStock > 0
          ? `Only ${Number(item.stock) || 0} of ${item.name} in stock, including the other options in your cart.`
          : `${item.name} is out of stock.`,
        'error'
      );
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
  
  // Only show a tab for a category that has products right now (plus "All"
  // and whichever tab is selected), so shoppers never open an empty category.
  // Until products load, every tab is shown so the bar doesn't jump.
  const categoriesInUse = new Set(products.map((p) => p.category).filter(Boolean));
  const visibleCategories = loading
    ? categories
    : categories.filter((c) => c.value === 'all' || c.value === filter || categoriesInUse.has(c.value));

  // Card-level average and count (every product); the product window lists
  // the reviews themselves.
  const reviewSummaries = ratingSummaries;

  const normalizedQuery = searchQuery.trim().toLowerCase();
  // The price boxes are plain text boxes: a number box can display text such
  // as "0e" while handing the page an empty value, which silently switched
  // the filter off. Now what is in the box is exactly what is filtered on,
  // so Max 0 shows only free items (normally none).
  const minPrice = priceMin === '' || priceMin === '.' ? null : Number(priceMin);
  const maxPrice = priceMax === '' || priceMax === '.' ? null : Number(priceMax);
  const priceFilterOn = minPrice !== null || maxPrice !== null;
  const filteredProducts = products
    .filter((p) => {
      const matchesCategory = filter === 'all' || p.category === filter;
      const matchesStock = !inStockOnly || (Number(p.stock) || 0) > 0;
      const price = Number(p.price) || 0;
      const matchesPrice =
        (minPrice === null || price >= minPrice) && (maxPrice === null || price <= maxPrice);
      // The search box looks for the product's name and nothing else.
      // Matching descriptions as well meant typing "wood" returned anything
      // whose write-up mentioned wood, which made the results look random.
      const matchesSearch =
        normalizedQuery === '' || String(p.name || '').toLowerCase().includes(normalizedQuery);
      return matchesCategory && matchesStock && matchesSearch && matchesPrice;
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
        case 'sales':
          return (soldCounts[b.id] || 0) - (soldCounts[a.id] || 0);
        case 'name':
          return String(a.name || '').localeCompare(String(b.name || ''));
        default:
          return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      }
    });

  // Recently viewed products that are still listed, newest first.
  const productById = new Map(products.map((product) => [product.id, product]));
  const recentlyViewed = recentIds.map((id) => productById.get(id)).filter(Boolean);

  // For the product window: more from the same shop, then similar products
  // (same category) from other shops, best sellers first.
  const bySales = (a, b) => (soldCounts[b.id] || 0) - (soldCounts[a.id] || 0);
  const moreFromShop = selectedProduct?.seller_id
    ? products
        .filter((item) => item.seller_id === selectedProduct.seller_id && item.id !== selectedProduct.id)
        .sort(bySales)
        .slice(0, 10)
    : [];
  const similarProducts = selectedProduct
    ? products
        .filter(
          (item) =>
            item.id !== selectedProduct.id &&
            item.seller_id !== selectedProduct.seller_id &&
            item.category &&
            item.category === selectedProduct.category
        )
        .sort(bySales)
        .slice(0, 10)
    : [];

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
            {/* Logo/Brand: back to the front of the shop, cleared of any
                search, category or product the customer had open. */}
            <Link
              href="/shop"
              aria-label="Back to the shop home page"
              onClick={() => {
                setSearchQuery('');
                setFilter('all');
                setSelectedProduct(null);
                setSelectedSellerId(null);
                setShowCart(false);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="flex items-center gap-3"
            >
              <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-700 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                </svg>
              </div>
              <div className="hidden sm:block">
                <h1 className="text-lg font-bold text-gray-900">Daet Local Shop</h1>
                <p className="text-xs text-gray-500">Authentic Bicol Products</p>
              </div>
            </Link>

            {/* Actions */}
            <div className="flex items-center gap-1 sm:gap-4">
              {user ? (
                <div className="flex items-center gap-1 sm:gap-3">
                  {/* Replies from shops and order updates, for a shopper who
                      never leaves the storefront. */}
                  {role !== 'admin' && role !== 'seller' && (
                    <>
                      <Link
                        href="/shop/buyer?tab=messages"
                        aria-label={
                          unreadMessages > 0 ? `Messages, ${unreadMessages} unread` : 'Messages'
                        }
                        title="Messages"
                        className="relative flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
                      >
                        <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                        {unreadMessages > 0 && (
                          <span className="absolute right-1 top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                            {unreadMessages > 99 ? '99+' : unreadMessages}
                          </span>
                        )}
                      </Link>
                      <NotificationCenter
                        audience="customer"
                        emptyMessage="Nothing new yet. Order updates and replies from shops appear here."
                      />
                    </>
                  )}
                  {/* The whole pill is the link, picture included, so tapping
                      anywhere on your own name opens your account rather than
                      only the few words of text in the middle of it. */}
                  <Link
                    href={accountHref}
                    aria-label={accountLabel}
                    title={accountLabel}
                    className="relative flex min-h-[44px] items-center gap-2 rounded-lg bg-blue-50 px-2 text-blue-700 transition-colors hover:bg-blue-100 sm:px-3"
                  >
                    <NavBadge count={accountBadge} placement="corner" label={accountBadgeLabel}/>
                    <Avatar
                      src={profile?.avatar_url}
                      name={profile?.full_name}
                      email={user?.email}
                      size="sm"
                    />
                    <span className="hidden max-w-[10rem] truncate text-sm font-medium text-gray-700 sm:block">
                      {profile?.full_name || accountLabel}
                    </span>
                  </Link>
                  <button
                    onClick={confirmSignOut}
                    aria-label="Log out"
                    title="Log out"
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg px-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50"
                  >
                    <svg className="h-5 w-5 sm:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    <span className="hidden sm:inline">Logout</span>
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
                className="relative flex min-h-[44px] items-center gap-2 rounded-lg bg-blue-600 px-3 text-white shadow-sm transition-all hover:bg-blue-700 hover:shadow sm:px-4"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                <span className="font-semibold hidden sm:inline">Cart</span>
                {cartItemCount > 0 && (
                  <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full w-6 h-6 flex items-center justify-center font-bold">
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          {/* Search Bar */}
          <div className="mb-3">
            <div className="relative max-w-2xl mx-auto">
              {/* "text", not "search": a search input draws its own clear X in
                  Chrome, which doubled up with our styled clear button below. */}
              <input
                type="text"
                aria-label="Search products"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search products by name..."
                className="w-full min-h-[44px] rounded-xl border-2 border-gray-200 px-6 pl-12 text-sm transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
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
          
          {/* Category Tabs. The emoji is a fixed-width inline-flex box so the
              label sits on the same line as its icon on every chip, whatever
              the emoji's own height, and the selected chip is marked with a
              ring rather than scale-105, which used to overlap its neighbours. */}
          <div className="-mx-1 flex gap-2.5 overflow-x-auto px-1 py-1 scrollbar-hide">
            {visibleCategories.map((category) => (
              <button
                key={category.value}
                onClick={() => setFilter(category.value)}
                className={`flex min-h-[44px] flex-shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-4 font-medium transition-colors ${
                  filter === category.value
                    ? 'bg-blue-600 text-white shadow-md ring-2 ring-blue-300'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <span aria-hidden="true" className="inline-flex w-5 justify-center text-base leading-none">
                  {category.icon}
                </span>
                <span className="text-sm leading-none">{category.label}</span>
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
                {/* Price range */}
                <div className="flex items-center gap-1.5 text-sm text-gray-700" role="group" aria-label="Price range">
                  <span className="sr-only sm:not-sr-only">₱</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={priceMin}
                    onChange={(e) => setPriceMin(cleanPrice(e.target.value))}
                    placeholder="Min"
                    aria-label="Minimum price"
                    className="min-h-[44px] w-20 rounded-lg border-2 border-gray-200 px-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                  />
                  <span aria-hidden="true">–</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={priceMax}
                    onChange={(e) => setPriceMax(cleanPrice(e.target.value))}
                    placeholder="Max"
                    aria-label="Maximum price"
                    className="min-h-[44px] w-20 rounded-lg border-2 border-gray-200 px-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                  />
                  {priceFilterOn && (
                    <button
                      type="button"
                      onClick={() => {
                        setPriceMin('');
                        setPriceMax('');
                      }}
                      className="min-h-[44px] px-1 text-xs font-semibold text-blue-600 hover:underline"
                    >
                      Clear
                    </button>
                  )}
                </div>
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
                    <option value="sales">Top Sales</option>
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
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-busy="true" aria-label="Loading products">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                <div className="skeleton aspect-[4/3] w-full" />
                <div className="space-y-3 p-4">
                  <div className="skeleton h-4 w-3/4 rounded" />
                  <div className="skeleton h-3 w-1/2 rounded" />
                  <div className="skeleton h-3 w-full rounded" />
                  <div className="skeleton mt-4 h-10 w-full rounded-lg" />
                </div>
              </div>
            ))}
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
            {(searchQuery || filter !== 'all' || inStockOnly || priceFilterOn) && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setFilter('all');
                  setInStockOnly(false);
                  setPriceMin('');
                  setPriceMax('');
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
          <>
            {/* Recently viewed: only on the plain front of the shop */}
            {recentlyViewed.length > 0 && !searchQuery && filter === 'all' && !priceFilterOn && (
              <section className="mb-6 mt-6 rounded-2xl bg-white p-4 shadow-sm" aria-label="Recently viewed">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-base font-bold text-gray-900">Recently viewed</h2>
                  <button
                    type="button"
                    onClick={() => {
                      clearRecentlyViewed();
                      setRecentIds([]);
                    }}
                    className="min-h-[36px] text-xs font-semibold text-gray-500 hover:text-gray-800"
                  >
                    Clear
                  </button>
                </div>
                <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
                  {recentlyViewed.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedProduct(item)}
                      className="w-28 flex-shrink-0 text-left"
                    >
                      <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-gray-100">
                        {item.image_url ? (
                          <Img src={item.image_url} alt={item.name} width={224} className="absolute inset-0 h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-[10px] text-gray-400">No image</div>
                        )}
                      </div>
                      <p className="mt-1 truncate text-xs text-gray-800">{item.name}</p>
                      <p className="text-xs font-bold text-blue-600">₱{Number(item.price).toFixed(2)}</p>
                    </button>
                  ))}
                </div>
              </section>
            )}
          <div className="stagger-children grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onAddToCart={addToCartFromCard}
                onBuyNow={buyNow}
                onViewDetails={setSelectedProduct}
                sellerInfo={sellers[product.seller_id]}
                onViewShop={() => setSelectedSellerId(product.seller_id)}
                reviewSummary={reviewSummaries[product.id]}
                sold={soldCounts[product.id] || 0}
                liked={likedIds.includes(product.id)}
                onToggleLike={toggleLike}
              />
            ))}
          </div>
          </>
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
        userId={user?.id}
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
        sold={selectedProduct ? soldCounts[selectedProduct.id] || 0 : 0}
        soldCounts={soldCounts}
        liked={Boolean(selectedProduct && likedIds.includes(selectedProduct.id))}
        onToggleLike={toggleLike}
        freeShippingThreshold={freeShippingThreshold}
        moreFromShop={moreFromShop}
        similarProducts={similarProducts}
        onSelectProduct={setSelectedProduct}
        onReport={openReport}
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
        categories={categories}
        soldCounts={soldCounts}
        followers={selectedSellerId ? followerCounts[selectedSellerId] || 0 : 0}
        following={Boolean(selectedSellerId && myFollows.has(selectedSellerId))}
        onToggleFollow={toggleFollow}
        onClose={() => setSelectedSellerId(null)}
        onViewProduct={(product) => {
          setSelectedSellerId(null);
          setSelectedProduct(product);
        }}
        onMessageShop={(seller) => messageShop(seller)}
        onReport={openReport}
      />

      <ReportDialog
        target={reportTarget}
        onClose={() => setReportTarget(null)}
        onDone={() => {
          setReportTarget(null);
          showToast('Thank you. The admin will review your report.', 'success');
        }}
      />

      {/* Auth Modal */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        mode="login"
        nextPath={loginNext}
      />
    </div>
  );
}
