'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import Link from 'next/link';
import { cancelMyOrder, confirmOrderReceived, formatOrderNumber, PAYMENT_LABELS } from '@/lib/orders';
import { fetchShopSettings } from '@/lib/shopSettings';
import PaymentInstructions from '@/components/shop/PaymentInstructions';
import ChangePasswordCard from '@/components/ChangePasswordCard';
import { joinName, splitName } from '@/lib/profile';
import { ROLE_LABELS } from '@/lib/roles';
import { useDialog } from '@/components/ui/Dialog';
import { cartLineId, describeSelection } from '@/lib/productOptions';
import ChatPanel from '@/components/shop/ChatPanel';
import { countUnread } from '@/lib/messages';
import Avatar from '@/components/ui/Avatar';
import AvatarUpload from '@/components/ui/AvatarUpload';
import NotificationCenter from '@/components/ui/NotificationCenter';
import { uploadPhotos } from '@/lib/attachments';
import { storeSelection } from '@/lib/checkoutSelection';
import {
  PHONE_HINT,
  describeNameProblem,
  describePhoneProblem,
  sanitizeName,
  sanitizePhone,
} from '@/lib/fieldRules';

// What each row of the points history was earned for
const REWARD_SOURCES = {
  shop_purchase: 'Purchase from a shop',
  shop_order: 'Purchase from a shop',
  event_attendance: 'Event attendance',
  signup_bonus: 'Welcome bonus',
};

// Shopee and Lazada both stop at five, and more than that is unreadable in a
// review card anyway.
const MAX_REVIEW_PHOTOS = 5;

const ORDER_STEPS = [
  { key: 'pending', label: 'Placed' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'processing', label: 'Processing' },
  { key: 'shipped', label: 'Shipped' },
  { key: 'delivered', label: 'Delivered' },
];

function OrderTracking({ status }) {
  if (status === 'cancelled') {
    return <p className="text-sm text-red-600 mt-3">This order was cancelled.</p>;
  }

  const currentIndex = ORDER_STEPS.findIndex((step) => step.key === status);

  return (
    <div className="flex items-center gap-1 mt-3">
      {ORDER_STEPS.map((step, index) => (
        <div key={step.key} className="flex-1">
          <div className={`h-1.5 rounded-full ${index <= currentIndex ? 'bg-blue-600' : 'bg-gray-200'}`} />
          <p className={`text-[10px] mt-1 ${index <= currentIndex ? 'text-blue-700 font-semibold' : 'text-gray-400'}`}>
            {step.label}
          </p>
        </div>
      ))}
    </div>
  );
}

function StarPicker({ value, onChange }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(star)}
          className={`flex min-h-[44px] min-w-[44px] items-center justify-center text-3xl leading-none ${star <= value ? 'text-yellow-500' : 'text-gray-300'}`}
          aria-label={`Rate ${star} star${star > 1 ? 's' : ''}`}
          aria-pressed={star <= value}
        >
          ★
        </button>
      ))}
    </div>
  );
}

export default function BuyerDashboard() {
  const { user, role, loading: authLoading, signOut } = useAuth();
  const { showAlert, showConfirm, showToast } = useDialog();
  const router = useRouter();

  const [orders, setOrders] = useState([]);
  const [profile, setProfile] = useState(null);
  const [products, setProducts] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('orders');
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingReview, setSavingReview] = useState(false);
  const [profileForm, setProfileForm] = useState({ first_name: '', last_name: '', phone: '', address: '', gender: '' });
  const [reviewDrafts, setReviewDrafts] = useState({});
  // Every time this shopper earned points, for the Rewards tab
  const [pointsHistory, setPointsHistory] = useState([]);
  // Which cart lines the customer wants to pay for now
  const [selectedLines, setSelectedLines] = useState([]);
  // Unread replies from shops, for the badge on the messages icon
  const [unreadMessages, setUnreadMessages] = useState(0);
  // What a notification pointed at: one conversation, or one order to scroll to
  const [openConversationId, setOpenConversationId] = useState(null);
  const [highlightOrderId, setHighlightOrderId] = useState(null);
  const [suspended, setSuspended] = useState(false);
  const [cancellingOrderId, setCancellingOrderId] = useState(null);
  const [confirmingOrderId, setConfirmingOrderId] = useState(null);
  const [cart, setCart] = useState([]);
  const [shopNames, setShopNames] = useState({});
  const [orderedProducts, setOrderedProducts] = useState({});

  // The chat shows shop names; shop_sellers is readable by everyone.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data } = await supabase.from('shop_sellers').select('id, business_name');
      if (cancelled || !data) return;

      setShopNames(
        data.reduce((acc, seller) => {
          acc[seller.id] = seller.business_name;
          return acc;
        }, {})
      );
    })();

    return () => {
      cancelled = true;
    };
  }, []);
  const [shopSettings, setShopSettings] = useState(null);

  // Open exactly what a link points at: a tab, and the order or conversation
  // inside it. Notifications link this way, so tapping one lands on the thing
  // it is about rather than on the top of a list.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const tab = params.get('tab');
      const conversation = params.get('conversation');
      const order = params.get('order');

      if (['orders', 'cart', 'messages', 'reviews', 'rewards', 'settings'].includes(tab)) {
        setActiveTab(tab);
      }

      if (conversation) setOpenConversationId(conversation);
      if (order) setHighlightOrderId(order);
    } catch (error) {
      console.error('Could not read the requested tab:', error);
    }
  }, []);

  // Bring the order a notification pointed at into view, once it has loaded.
  useEffect(() => {
    if (!highlightOrderId || activeTab !== 'orders' || orders.length === 0) return;

    const node = document.getElementById(`order-${highlightOrderId}`);
    if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightOrderId, activeTab, orders]);

  // Contact and payment details from Admin -> Settings
  useEffect(() => {
    let cancelled = false;
    fetchShopSettings().then((settings) => {
      if (!cancelled) setShopSettings(settings);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Wait for the session to resolve before redirecting, otherwise a fresh
    // login bounce sends the buyer back to the shop page.
    if (authLoading) return;

    if (!user) {
      router.push('/shop');
      return;
    }

    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading, router]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [profileRes, ordersRes, productsRes, reviewsRes, rewardsRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
        supabase
          .from('shop_orders')
          .select(`
            *,
            shop_order_items (
              product_id,
              product_name,
              quantity,
              price
            )
          `)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('shop_products')
          .select('id, name, description, price, stock, category, image_url, artisan_name')
          .eq('available', true)
          .order('created_at', { ascending: false })
          .limit(60),
        supabase
          .from('shop_reviews')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false }),
        // The points history behind the Rewards tab
        supabase
          .from('reward_history')
          .select('id, subsystem_source, points_earned, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(100),
      ]);

      if (profileRes.error && profileRes.error.code !== 'PGRST116') {
        console.error('Error loading profile:', profileRes.error);
      }
      if (ordersRes.error) console.error('Error loading orders:', ordersRes.error);
      if (productsRes.error) console.error('Error loading products:', productsRes.error);
      if (reviewsRes.error) console.error('Error loading reviews:', reviewsRes.error);

      // A suspended customer sees a blocked screen instead of the dashboard
      setSuspended(Boolean(profileRes.data?.is_suspended));
      setProfile(profileRes.data || null);
      // Older accounts only have full_name, so split it for the two boxes.
      const storedName = splitName(profileRes.data?.full_name);
      setProfileForm({
        first_name: profileRes.data?.first_name || storedName.firstName,
        last_name: profileRes.data?.last_name || storedName.lastName,
        phone: profileRes.data?.phone || '',
        address: profileRes.data?.address || '',
        gender: profileRes.data?.gender || '',
      });
      setOrders(ordersRes.data || []);

      // The photo and shop behind each purchased item, for the review cards
      const purchasedIds = [
        ...new Set(
          (ordersRes.data || [])
            .flatMap((order) => order.shop_order_items || [])
            .map((item) => item.product_id)
            .filter(Boolean)
        ),
      ];

      if (purchasedIds.length > 0) {
        const { data: purchased } = await supabase
          .from('shop_products')
          .select('id, name, image_url, seller_id')
          .in('id', purchasedIds);

        setOrderedProducts(
          (purchased || []).reduce((acc, product) => {
            acc[product.id] = product;
            return acc;
          }, {})
        );
      }
      setProducts(productsRes.data || []);
      setReviews(reviewsRes.data || []);

      // Points history is nice to have, never a reason to fail the dashboard.
      if (rewardsRes.error) {
        console.warn('Points history unavailable:', rewardsRes.error.message);
        setPointsHistory([]);
      } else {
        setPointsHistory(rewardsRes.data || []);
      }

    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const cartKey = user ? `shop_cart:${user.id}` : null;

  // The cart lives in this browser under the signed-in customer's own key, so
  // the dashboard can show and edit it without sending anyone back to the shop.
  const readCart = useCallback(() => {
    if (!cartKey) return [];
    try {
      const stored = localStorage.getItem(cartKey);
      const parsed = stored ? JSON.parse(stored) : [];

      // Carts saved before product options existed have no line id.
      return (Array.isArray(parsed) ? parsed : []).map((item) => ({
        ...item,
        productId: item.productId || item.id,
        selectedOptions: item.selectedOptions || {},
        lineId: item.lineId || cartLineId(item.productId || item.id, item.selectedOptions),
      }));
    } catch (error) {
      console.error('Error reading the cart:', error);
      return [];
    }
  }, [cartKey]);

  const writeCart = (next) => {
    setCart(next);
    if (!cartKey) return;
    try {
      if (next.length > 0) {
        localStorage.setItem(cartKey, JSON.stringify(next));
      } else {
        localStorage.removeItem(cartKey);
      }
    } catch (error) {
      console.error('Error saving the cart:', error);
    }
  };

  useEffect(() => {
    setCart(readCart());
  }, [readCart]);

  const cartCount = cart.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);

  // A new line is ticked by default; a removed one stops counting.
  useEffect(() => {
    setSelectedLines((current) => {
      const present = cart.map((item) => item.lineId);
      const kept = current.filter((lineId) => present.includes(lineId));
      const added = present.filter((lineId) => !current.includes(lineId));
      return [...kept, ...added];
    });
  }, [cart]);

  // Keep the badge on the messages icon honest while the dashboard is open.
  useEffect(() => {
    if (!user?.id) return undefined;

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
  }, [user?.id, activeTab]);

  const toggleCartLine = (lineId) =>
    setSelectedLines((current) =>
      current.includes(lineId) ? current.filter((id) => id !== lineId) : [...current, lineId]
    );

  const selectedCartItems = cart.filter((item) => selectedLines.includes(item.lineId));
  const allLinesSelected = cart.length > 0 && selectedCartItems.length === cart.length;
  const selectedCartTotal = selectedCartItems.reduce(
    (sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 0),
    0
  );

  const changeCartQuantity = (lineId, quantity) => {
    const item = cart.find((entry) => entry.lineId === lineId);
    if (!item) return;

    // The minus button never empties a line; "Remove" does, and it asks first.
    if (quantity < 1) return;

    const maxStock = Number(item.stock) || 0;
    if (maxStock && quantity > maxStock) {
      showAlert(`Only ${maxStock} of ${item.name} in stock.`);
      return;
    }

    writeCart(cart.map((entry) => (entry.lineId === lineId ? { ...entry, quantity } : entry)));
  };

  /** Taking something out of the cart is easy to do by accident, so ask. */
  const removeCartLine = async (item) => {
    const confirmed = await showConfirm({
      tone: 'warning',
      title: 'Remove this item?',
      message: `"${item.name}" will be taken out of your cart.`,
      confirmLabel: 'Remove',
      cancelLabel: 'Keep it',
    });

    if (confirmed) writeCart(cart.filter((entry) => entry.lineId !== item.lineId));
  };

  const handleConfirmReceived = async (order) => {
    if (confirmingOrderId) return;
    const confirmed = await showConfirm({
      tone: 'question',
      title: 'Did your order arrive?',
      message: `Confirm that order ${formatOrderNumber(order.id)} was delivered. You can rate the items afterwards.`,
      confirmLabel: 'Yes, it arrived',
      cancelLabel: 'Not yet',
    });
    if (!confirmed) return;

    setConfirmingOrderId(order.id);
    try {
      await confirmOrderReceived(order.id);
      setOrders((prev) => prev.map((row) => (row.id === order.id ? { ...row, status: 'delivered' } : row)));
      showToast('Thank you! You can now rate the items in My Reviews.', 'success');
    } catch (error) {
      console.error('Error confirming the order:', error);
      showAlert(error.message || 'Could not confirm this order.');
    } finally {
      setConfirmingOrderId(null);
    }
  };

  const handleLogout = async () => {
    const confirmed = await showConfirm({
      tone: 'question',
      title: 'Log out?',
      message: 'You will need to sign in again to see your orders and cart.',
      confirmLabel: 'Log out',
      cancelLabel: 'Stay signed in',
    });
    if (!confirmed) return;

    // signOut clears the session and navigates to the shop itself, so the
    // dashboard can never linger with stale data.
    await signOut({ redirectTo: '/shop' });
  };

  const saveProfile = async () => {
    setSavingProfile(true);

    try {
      const firstNameProblem = describeNameProblem(profileForm.first_name, 'first name');
      if (firstNameProblem) {
        showAlert(firstNameProblem);
        return;
      }

      const lastNameProblem = describeNameProblem(profileForm.last_name, 'last name');
      if (lastNameProblem) {
        showAlert(lastNameProblem);
        return;
      }

      const phoneProblem = describePhoneProblem(profileForm.phone, { required: false });
      if (phoneProblem) {
        showAlert(phoneProblem);
        return;
      }

      const fullName = joinName(profileForm.first_name, profileForm.last_name);

      const base = {
        full_name: fullName,
        phone: profileForm.phone || null,
        address: profileForm.address || null,
        updated_at: new Date().toISOString(),
      };

      const named = {
        ...base,
        first_name: profileForm.first_name.trim() || null,
        last_name: profileForm.last_name.trim() || null,
      };

      let { error } = await supabase
        .from('profiles')
        .update({ ...named, gender: profileForm.gender || null })
        .eq('id', user.id);

      // Database without the gender column yet, then without the name columns:
      // save as much as it can hold rather than losing the whole edit.
      if (error && /gender/.test(error.message || '')) {
        ({ error } = await supabase.from('profiles').update(named).eq('id', user.id));
      }

      if (error && /first_name|last_name/.test(error.message || '')) {
        ({ error } = await supabase.from('profiles').update(base).eq('id', user.id));
      }

      if (error) {
        if (error.message?.includes('phone') || error.message?.includes('address')) {
          showAlert('Saving an address needs the phone/address columns. Re-run supabase-admin-policies.sql in Supabase.');
          return;
        }
        throw error;
      }

      setProfile((prev) => ({ ...prev, ...profileForm, full_name: fullName }));
      showToast('Profile updated!', 'success');
    } catch (error) {
      console.error('Error saving profile:', error);
      showAlert('Failed to update profile: ' + error.message);
    } finally {
      setSavingProfile(false);
    }
  };

  /** Attach photos to the review being written for one delivered item. */
  const addReviewPhotos = (productId, fileList) => {
    const chosen = Array.from(fileList || []).filter((file) => file.type.startsWith('image/'));
    if (chosen.length === 0) return;

    setReviewDrafts((prev) => {
      const draft = prev[productId] || { rating: 5, comment: '', photos: [] };
      const current = draft.photos || [];
      const room = MAX_REVIEW_PHOTOS - current.length;

      if (room <= 0) {
        showToast(`A review can have at most ${MAX_REVIEW_PHOTOS} photos.`, 'info');
        return prev;
      }

      if (chosen.length > room) {
        showToast(`Only ${room} more ${room === 1 ? 'photo' : 'photos'} fit on this review.`, 'info');
      }

      const photos = [
        ...current,
        ...chosen.slice(0, room).map((file) => ({ file, preview: URL.createObjectURL(file) })),
      ];

      return { ...prev, [productId]: { ...draft, photos } };
    });
  };

  const removeReviewPhoto = (productId, index) => {
    setReviewDrafts((prev) => {
      const draft = prev[productId] || { rating: 5, comment: '', photos: [] };
      const photo = (draft.photos || [])[index];
      if (photo) URL.revokeObjectURL(photo.preview);

      return {
        ...prev,
        [productId]: { ...draft, photos: (draft.photos || []).filter((_, position) => position !== index) },
      };
    });
  };

  const submitReview = async (item) => {
    const draft = reviewDrafts[item.product_id] || { rating: 5, comment: '', photos: [] };
    const rating = Number(draft.rating);
    const comment = (draft.comment || '').trim();

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      showAlert('Please choose a star rating from 1 to 5.');
      return;
    }

    if (comment.length > 1000) {
      showAlert('Please keep your review under 1,000 characters.');
      return;
    }

    // The UI only offers delivered items, but re-check so a stale tab cannot
    // submit a review for something that was never delivered.
    if (!reviewableItems.some((entry) => entry.product_id === item.product_id)) {
      showAlert('This item is not ready for review. Only delivered items can be reviewed.');
      return;
    }

    setSavingReview(true);

    try {
      // Photos go up first: a failed upload should not leave a half-written review.
      const chosen = (draft.photos || []).map((photo) => photo.file);
      const photoUrls = chosen.length > 0 ? await uploadPhotos(chosen, 'review') : [];

      const review = {
        product_id: item.product_id,
        user_id: user.id,
        rating,
        comment: comment || null,
      };

      // Copy the author's name and picture onto the review, so other shoppers
      // can see who wrote it without being able to read profiles.
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

      if (error) throw error;

      const { data } = await supabase
        .from('shop_reviews')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      setReviews(data || []);
      (draft.photos || []).forEach((photo) => URL.revokeObjectURL(photo.preview));
      setReviewDrafts((prev) => ({ ...prev, [item.product_id]: { rating: 5, comment: '', photos: [] } }));
      showToast('Thank you for your review!', 'success');
    } catch (error) {
      console.error('Error saving review:', error);
      showAlert('Failed to save review: ' + error.message);
    } finally {
      setSavingReview(false);
    }
  };

  const handleCancelOrder = async (order) => {
    if (cancellingOrderId) return;
    const confirmed = await showConfirm({
      tone: 'warning',
      title: `Cancel order ${formatOrderNumber(order.id)}?`,
      message: 'The items go back on sale and any reward points from this order are removed.',
      confirmLabel: 'Cancel my order',
      cancelLabel: 'Keep it',
    });
    if (!confirmed) return;

    setCancellingOrderId(order.id);
    try {
      await cancelMyOrder(order.id);
      setOrders((prev) => prev.map((row) => (row.id === order.id ? { ...row, status: 'cancelled' } : row)));
      // Points may have changed, so refresh the profile card too
      const { data } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
      if (data) setProfile(data);
      showToast(`Order ${formatOrderNumber(order.id)} was cancelled.`, 'success');
    } catch (error) {
      console.error('Error cancelling order:', error);
      showAlert(error.message || 'Could not cancel the order. Please contact the shop.');
    } finally {
      setCancellingOrderId(null);
    }
  };

  const getStatusColor = (status) => {
    const colors = {
      pending: 'bg-yellow-100 text-yellow-700',
      confirmed: 'bg-blue-100 text-blue-700',
      processing: 'bg-blue-100 text-blue-700',
      shipped: 'bg-blue-100 text-blue-700',
      delivered: 'bg-green-100 text-green-700',
      cancelled: 'bg-red-100 text-red-700'
    };
    return colors[status] || 'bg-gray-100 text-gray-700';
  };

  const getOrderStats = () => {
    const toPay = orders.filter(o => o.status === 'pending').length;
    const toShip = orders.filter(o => o.status === 'confirmed' || o.status === 'processing').length;
    const toReceive = orders.filter(o => o.status === 'shipped').length;
    const completed = orders.filter(o => o.status === 'delivered').length;

    return { toPay, toShip, toReceive, completed };
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (suspended) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.84-2.75L13.74 4a2 2 0 00-3.5 0L3.16 16.25A2 2 0 005 19z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Account Suspended</h2>
          <p className="text-gray-600 mb-6">
            This account has been suspended by an administrator. Please contact CONNECT-Daet support if you believe this is a mistake.
          </p>
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              window.location.href = '/shop';
            }}
            className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700"
          >
            Back to Shop
          </button>
        </div>
      </div>
    );
  }

  const stats = getOrderStats();
  const points = (profile?.points ?? profile?.reward_points) || 0;
  const reviewedProductIds = new Set(reviews.map((review) => review.product_id));

  // Delivered items this buyer can still review (one entry per product)
  // What was actually bought, so a review in the history shows the product and
  // the order it came from instead of a bare star rating.
  const purchaseByProduct = new Map();
  orders.forEach((order) => {
    (order.shop_order_items || []).forEach((item) => {
      if (!item.product_id) return;
      const existing = purchaseByProduct.get(item.product_id);
      if (!existing || new Date(order.created_at) > new Date(existing.orderDate)) {
        purchaseByProduct.set(item.product_id, {
          name: item.product_name,
          quantity: Number(item.quantity) || 0,
          price: Number(item.price) || 0,
          orderId: order.id,
          orderDate: order.created_at,
          status: order.status,
        });
      }
    });
  });

  // Photos come from the catalogue when the product is still listed, and from
  // the order lookup when it is not.
  const productImageById = new Map([
    ...products.map((product) => [product.id, product.image_url]),
    ...Object.values(orderedProducts).map((product) => [product.id, product.image_url]),
  ]);

  const reviewableItems = orders
    .filter((order) => order.status === 'delivered')
    .flatMap((order) => (order.shop_order_items || []).map((item) => ({ ...item, orderId: order.id })))
    .filter((item) => item.product_id)
    .filter((item, index, all) => all.findIndex((entry) => entry.product_id === item.product_id) === index)
    .filter((item) => !reviewedProductIds.has(item.product_id));

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex min-h-16 items-center justify-between gap-3 py-2">
            <div className="flex items-center gap-2 sm:gap-4">
              <Link href="/shop" className="text-lg font-bold sm:text-2xl">
                CONNECT-Daet
              </Link>
              <span className="rounded-full bg-white/20 px-2 py-1 text-xs font-semibold text-white sm:px-3">
                Customer
              </span>
            </div>
            <div className="flex items-center gap-2 sm:gap-4">
              {/* Messages from shops and every step of an order land here */}
              <div className="rounded-full bg-white/10 text-white [&_button]:text-white [&_button:hover]:bg-white/20 [&_button:hover]:text-white">
                <NotificationCenter
                  audience="customer"
                  emptyMessage="Nothing new yet. Order updates and replies from shops appear here."
                  onNavigate={(link) => {
                    const url = new URL(link, window.location.origin);

                    if (!url.pathname.startsWith('/shop/buyer')) {
                      window.location.href = link;
                      return;
                    }

                    const tab = url.searchParams.get('tab');
                    const conversation = url.searchParams.get('conversation');
                    const order = url.searchParams.get('order');

                    if (tab) setActiveTab(tab);
                    if (conversation) setOpenConversationId(conversation);
                    setHighlightOrderId(order || null);
                  }}
                />
              </div>
              {/* Messages stay one tap away here too: the icon in the shop
                  header used to vanish the moment you opened your account. */}
              <button
                type="button"
                onClick={() => setActiveTab('messages')}
                aria-label={unreadMessages > 0 ? `Messages, ${unreadMessages} unread` : 'Messages'}
                title="Messages"
                className="relative flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-white transition-colors hover:bg-white/20"
              >
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                {unreadMessages > 0 && (
                  <span className="absolute right-1 top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                    {unreadMessages > 99 ? '99+' : unreadMessages}
                  </span>
                )}
              </button>

              {/* Your own name and picture open your profile */}
              <button
                type="button"
                onClick={() => setActiveTab('settings')}
                title="View my profile"
                className="hidden items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-white/10 sm:flex"
              >
                <Avatar src={profile?.avatar_url} name={profile?.full_name} email={user?.email} size="sm" />
                <span className="max-w-[12rem] text-right">
                  <span className="block truncate text-sm font-semibold">{profile?.full_name || user?.email}</span>
                  <span className="block text-xs text-white/80">View my profile</span>
                </span>
              </button>
              {/* The tab strip below carries Log Out on phones, so this one
                  only appears once there is room for it. */}
              <button
                onClick={handleLogout}
                className="hidden min-h-[44px] rounded-lg bg-red-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-red-700 sm:block"
              >
                Log Out
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Welcome Section */}
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">
            Hi, {profile?.full_name?.split(' ')[0] || user?.email?.split('@')[0] || 'Shopper'}! 👋
          </h1>
          <p className="text-gray-600">Shop your favorite products today!</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Sidebar */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <nav className="flex overflow-x-auto lg:flex-col">
                <button
                  onClick={() => setActiveTab('orders')}
                  className={`flex min-h-[44px] items-center gap-2 px-4 py-3 text-left text-sm font-medium transition-colors whitespace-nowrap lg:gap-3 lg:px-6 lg:py-4 ${
                    activeTab === 'orders'
                      ? 'bg-blue-50 text-blue-600 border-b-4 border-blue-600 lg:border-b-0 lg:border-l-4'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                  </svg>
                  My Orders
                  {orders.length > 0 && (
                    <span className="ml-auto px-2 py-1 bg-blue-100 text-blue-600 text-xs font-bold rounded-full">
                      {orders.length}
                    </span>
                  )}
                </button>

                <button
                  onClick={() => setActiveTab('cart')}
                  className={`flex min-h-[44px] items-center gap-2 px-4 py-3 text-left text-sm font-medium transition-colors whitespace-nowrap lg:gap-3 lg:px-6 lg:py-4 ${
                    activeTab === 'cart'
                      ? 'bg-blue-50 text-blue-600 border-b-4 border-blue-600 lg:border-b-0 lg:border-l-4'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                  My Cart
                  {cartCount > 0 && (
                    <span className="ml-auto px-2 py-1 bg-blue-100 text-blue-600 text-xs font-bold rounded-full">
                      {cartCount}
                    </span>
                  )}
                </button>

                <button
                  onClick={() => setActiveTab('reviews')}
                  className={`flex min-h-[44px] items-center gap-2 px-4 py-3 text-left text-sm font-medium transition-colors whitespace-nowrap lg:gap-3 lg:px-6 lg:py-4 ${
                    activeTab === 'reviews'
                      ? 'bg-blue-50 text-blue-600 border-b-4 border-blue-600 lg:border-b-0 lg:border-l-4'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                  My Reviews
                </button>

                <button
                  onClick={() => setActiveTab('rewards')}
                  className={`flex min-h-[44px] items-center gap-2 px-4 py-3 text-left text-sm font-medium transition-colors whitespace-nowrap lg:gap-3 lg:px-6 lg:py-4 ${
                    activeTab === 'rewards'
                      ? 'bg-blue-50 text-blue-600 border-b-4 border-blue-600 lg:border-b-0 lg:border-l-4'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zM5 12h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
                  </svg>
                  Rewards
                  {points > 0 && (
                    <span className="ml-auto px-2 py-1 bg-yellow-100 text-yellow-700 text-xs font-bold rounded-full">
                      {points}
                    </span>
                  )}
                </button>

                <button
                  onClick={() => setActiveTab('settings')}
                  className={`flex min-h-[44px] items-center gap-2 px-4 py-3 text-left text-sm font-medium transition-colors whitespace-nowrap lg:gap-3 lg:px-6 lg:py-4 ${
                    activeTab === 'settings'
                      ? 'bg-blue-50 text-blue-600 border-b-4 border-blue-600 lg:border-b-0 lg:border-l-4'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Settings
                </button>

                <button
                  onClick={handleLogout}
                  className="flex min-h-[44px] items-center gap-2 whitespace-nowrap border-t px-4 py-3 text-left text-sm font-medium text-red-600 transition-colors hover:bg-red-50 lg:gap-3 lg:px-6 lg:py-4"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  Log Out
                </button>
              </nav>
            </div>
          </div>

          {/* Main Content */}
          <div className="lg:col-span-3">
            {activeTab === 'orders' && (
              <div className="space-y-6">
                {/* At a glance: where every order stands */}
                {/* Order Status */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                  <h3 className="text-lg font-bold text-gray-900 mb-4">My Order Status</h3>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <div className="text-center">
                      <div className="w-16 h-16 mx-auto mb-2 bg-yellow-100 rounded-full flex items-center justify-center">
                        <svg className="w-8 h-8 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <p className="text-2xl font-bold text-gray-900">{stats.toPay}</p>
                      <p className="text-sm text-gray-600">To Pay</p>
                    </div>

                    <div className="text-center">
                      <div className="w-16 h-16 mx-auto mb-2 bg-blue-100 rounded-full flex items-center justify-center">
                        <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                        </svg>
                      </div>
                      <p className="text-2xl font-bold text-gray-900">{stats.toShip}</p>
                      <p className="text-sm text-gray-600">To Ship</p>
                    </div>

                    <div className="text-center">
                      <div className="w-16 h-16 mx-auto mb-2 bg-blue-100 rounded-full flex items-center justify-center">
                        <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
                        </svg>
                      </div>
                      <p className="text-2xl font-bold text-gray-900">{stats.toReceive}</p>
                      <p className="text-sm text-gray-600">To Receive</p>
                    </div>

                    <div className="text-center">
                      <div className="w-16 h-16 mx-auto mb-2 bg-green-100 rounded-full flex items-center justify-center">
                        <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <p className="text-2xl font-bold text-gray-900">{stats.completed}</p>
                      <p className="text-sm text-gray-600">Completed</p>
                    </div>
                  </div>
                </div>
              <div className="bg-white rounded-xl shadow-sm border border-gray-100">
                <div className="p-6 border-b">
                  <h2 className="text-2xl font-bold text-gray-900">My Orders</h2>
                  <p className="text-sm text-gray-600 mt-1">Track each delivery from order placed to delivered.</p>
                </div>
                <div className="p-6">
                  {orders.length === 0 ? (
                    <div className="text-center py-12">
                      <svg className="w-24 h-24 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                      </svg>
                      <h3 className="text-lg font-semibold text-gray-900 mb-2">No orders yet</h3>
                      <p className="text-gray-600 mb-4">Start shopping to see your orders here!</p>
                      <Link href="/shop" className="inline-block px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700">
                        Shop Now
                      </Link>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {orders.map((order) => (
                        <div
                          key={order.id}
                          id={`order-${order.id}`}
                          className={`rounded-lg border p-6 transition-colors ${
                            highlightOrderId === order.id
                              ? 'border-blue-500 ring-2 ring-blue-200'
                              : 'border-gray-200 hover:border-blue-300'
                          }`}
                        >
                          <div className="flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-start mb-4">
                            <div>
                              <p className="text-sm text-gray-600">Order <span className="font-mono font-semibold text-blue-600">{formatOrderNumber(order.id)}</span></p>
                              <p className="text-sm text-gray-600">
                                Placed on{' '}
                                {new Date(order.created_at).toLocaleString('en-PH', {
                                  dateStyle: 'medium',
                                  timeStyle: 'short',
                                })}
                              </p>
                            </div>
                            <span className={`self-start px-3 py-1 text-xs font-semibold rounded-full ${getStatusColor(order.status)}`}>
                              {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                            </span>
                          </div>

                          <OrderTracking status={order.status} />

                          {order.status === 'shipped' && (
                            <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">
                              Parcel on the way. Tap <strong>Order Received</strong> once it arrives so the shop is paid
                              and you can rate what you bought.
                            </p>
                          )}

                          <div className="border-t pt-4 mt-4">
                            <h4 className="font-semibold mb-2 text-gray-900">Items:</h4>
                            {order.shop_order_items?.map((item, idx) => (
                              <div key={idx} className="flex justify-between text-sm text-gray-600 mb-1">
                                <span>
                                  {item.product_name} x{item.quantity}
                                  {describeSelection(item.options) && (
                                    <span className="block text-xs text-gray-500">
                                      {describeSelection(item.options)}
                                    </span>
                                  )}
                                </span>
                                <span className="font-semibold">₱{(Number(item.price) * Number(item.quantity)).toFixed(2)}</span>
                              </div>
                            ))}
                          </div>

                          {order.delivery_address && (
                            <div className="border-t mt-4 pt-4 text-sm text-gray-600">
                              <p className="font-semibold text-gray-900 mb-1">Deliver to</p>
                              <p className="break-words">{order.customer_name}{order.customer_phone ? ` · ${order.customer_phone}` : ''}</p>
                              <p className="break-words whitespace-pre-line">{order.delivery_address}</p>
                            </div>
                          )}

                          <div className="border-t mt-4 pt-4 flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center">
                            <div>
                              {Number(order.shipping_fee) > 0 && (
                                <p className="text-xs text-gray-500">
                                  Items ₱{(Number(order.total_amount) - Number(order.shipping_fee)).toFixed(2)} +
                                  delivery ₱{Number(order.shipping_fee).toFixed(2)}
                                </p>
                              )}
                              <p className="text-sm text-gray-600">Total Amount</p>
                              <p className="text-2xl font-bold text-blue-600">₱{Number(order.total_amount).toFixed(2)}</p>
                            </div>
                            <div className="flex flex-col gap-2 text-sm text-gray-600 sm:items-end">
                              <p>Payment: <span className="font-semibold">{PAYMENT_LABELS[order.payment_method] || order.payment_method}</span></p>
                              {order.payment_proof_url && (
                                <a
                                  href={order.payment_proof_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs font-semibold text-green-700 hover:underline"
                                >
                                  Receipt attached ✓
                                </a>
                              )}
                              {order.status === 'pending' && (
                                <button
                                  type="button"
                                  onClick={() => handleCancelOrder(order)}
                                  disabled={cancellingOrderId === order.id}
                                  className="min-h-[44px] rounded-lg border-2 border-red-200 px-4 font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                                >
                                  {cancellingOrderId === order.id ? 'Cancelling...' : 'Cancel order'}
                                </button>
                              )}
                              {order.status === 'shipped' && (
                                <button
                                  type="button"
                                  onClick={() => handleConfirmReceived(order)}
                                  disabled={confirmingOrderId === order.id}
                                  className="min-h-[44px] rounded-lg bg-green-600 px-5 font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                                >
                                  {confirmingOrderId === order.id ? 'Confirming...' : '✓ Order Received'}
                                </button>
                              )}
                              {order.status === 'delivered' && (
                                <button
                                  type="button"
                                  onClick={() => setActiveTab('reviews')}
                                  className="min-h-[44px] rounded-lg border-2 border-yellow-300 px-4 font-semibold text-yellow-700 hover:bg-yellow-50"
                                >
                                  ★ Rate the items
                                </button>
                              )}
                            </div>
                          </div>

                          {order.status === 'pending' && ['gcash', 'bank'].includes(order.payment_method) && (
                            <div className="mt-4">
                              <PaymentInstructions
                                method={order.payment_method}
                                settings={shopSettings}
                                amount={Number(order.total_amount)}
                                orderNumbers={[formatOrderNumber(order.id)]}
                                compact
                              />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              </div>
            )}

            {activeTab === 'messages' && (
              <div className="space-y-4">
                <button
                  type="button"
                  onClick={() => setActiveTab('orders')}
                  className="inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-blue-600 hover:text-blue-700"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  Back to my orders
                </button>
                <ChatPanel
                  role="buyer"
                  shopNameById={shopNames}
                  activeConversationId={openConversationId}
                />
              </div>
            )}

            {activeTab === 'cart' && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100">
                <div className="flex flex-col gap-3 border-b p-6 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-2xl font-bold text-gray-900">My Cart</h2>
                    <p className="text-sm text-gray-600 mt-1">
                      {cartCount === 0
                        ? 'Your cart is empty.'
                        : `${cartCount} ${cartCount === 1 ? 'item' : 'items'} ready for checkout.`}
                    </p>
                  </div>
                  <Link
                    href="/shop"
                    className="inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-blue-200 px-5 text-sm font-semibold text-blue-600 transition-colors hover:bg-blue-50"
                  >
                    + Add more items
                  </Link>
                </div>

                <div className="p-6">
                  {cart.length === 0 ? (
                    <div className="text-center py-12">
                      <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                      <h3 className="text-lg font-semibold text-gray-900 mb-2">Nothing in your cart yet</h3>
                      <p className="text-gray-600 mb-4">Browse the shop and tap Add to Cart.</p>
                      <Link
                        href="/shop"
                        className="inline-flex min-h-[44px] items-center rounded-lg bg-blue-600 px-6 font-medium text-white transition-colors hover:bg-blue-700"
                      >
                        Browse the Shop
                      </Link>
                    </div>
                  ) : (
                    <>
                      <label className="mb-4 flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl bg-gray-50 px-4">
                        <input
                          type="checkbox"
                          checked={allLinesSelected}
                          onChange={(event) =>
                            setSelectedLines(event.target.checked ? cart.map((item) => item.lineId) : [])
                          }
                          className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-600"
                        />
                        <span className="text-sm font-semibold text-gray-700">
                          Select all · {selectedCartItems.length} of {cart.length} selected
                        </span>
                      </label>

                      <div className="space-y-4">
                        {cart.map((item) => (
                          <div
                            key={item.lineId}
                            className={`flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center ${
                              selectedLines.includes(item.lineId)
                                ? 'border-blue-300'
                                : 'border-gray-100 opacity-70'
                            }`}
                          >
                            {/* Tick the lines you want to pay for now */}
                            <input
                              type="checkbox"
                              checked={selectedLines.includes(item.lineId)}
                              onChange={() => toggleCartLine(item.lineId)}
                              aria-label={`Check out ${item.name}`}
                              className="h-5 w-5 flex-shrink-0 rounded border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-600"
                            />

                            <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg bg-gray-100">
                              {item.image_url ? (
                                <img src={item.image_url} alt={item.name} className="h-full w-full object-cover" />
                              ) : (
                                <div className="flex h-full items-center justify-center text-xs text-gray-400">No image</div>
                              )}
                            </div>

                            <div className="min-w-0 flex-1">
                              <Link
                                href={`/shop?product=${item.productId || item.id}`}
                                className="font-semibold text-gray-900 line-clamp-2 hover:text-blue-600"
                              >
                                {item.name}
                              </Link>
                              {describeSelection(item.selectedOptions) && (
                                <p className="text-xs font-medium text-gray-500">
                                  {describeSelection(item.selectedOptions)}
                                </p>
                              )}
                              <p className="font-bold text-blue-600">₱{Number(item.price).toFixed(2)}</p>
                            </div>

                            <div className="flex items-center gap-3">
                              <div className="flex items-center rounded-lg border border-gray-200">
                                <button
                                  type="button"
                                  onClick={() => changeCartQuantity(item.lineId, Number(item.quantity) - 1)}
                                  disabled={Number(item.quantity) <= 1}
                                  aria-label={`Remove one ${item.name}`}
                                  className="flex h-11 w-11 items-center justify-center text-lg font-bold text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  −
                                </button>
                                <span className="w-10 text-center font-semibold">{item.quantity}</span>
                                <button
                                  type="button"
                                  onClick={() => changeCartQuantity(item.lineId, Number(item.quantity) + 1)}
                                  aria-label={`Add one ${item.name}`}
                                  className="flex h-11 w-11 items-center justify-center text-lg font-bold text-gray-600 hover:bg-gray-50"
                                >
                                  +
                                </button>
                              </div>

                              <div className="text-right">
                                <p className="text-xs text-gray-500">Subtotal</p>
                                <p className="font-bold text-gray-900">
                                  ₱{((Number(item.price) || 0) * (Number(item.quantity) || 0)).toFixed(2)}
                                </p>
                              </div>

                              <button
                                type="button"
                                onClick={() => removeCartLine(item)}
                                aria-label={`Remove ${item.name} from the cart`}
                                className="flex h-11 w-11 items-center justify-center rounded-lg text-red-600 hover:bg-red-50"
                              >
                                🗑
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="mt-6 border-t pt-4">
                        <div className="flex items-center justify-between">
                          <span className="text-lg font-semibold text-gray-900">
                            Total ({selectedCartItems.length} selected)
                          </span>
                          <span className="text-2xl font-bold text-blue-600">₱{selectedCartTotal.toFixed(2)}</span>
                        </div>

                        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                          <button
                            type="button"
                            onClick={() => {
                              // Only the ticked lines travel to checkout
                              storeSelection(user.id, selectedLines);
                              router.push('/shop/checkout');
                            }}
                            disabled={selectedCartItems.length === 0}
                            className="flex min-h-[48px] flex-1 items-center justify-center rounded-full bg-blue-600 font-bold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                          >
                            {selectedCartItems.length === 0
                              ? 'Select an item to check out'
                              : `Check Out ${selectedCartItems.length} ${selectedCartItems.length === 1 ? 'Item' : 'Items'} →`}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              showConfirm({
                                tone: 'warning',
                                title: 'Empty your cart?',
                                message: 'Every item will be removed from your cart.',
                                confirmLabel: 'Clear cart',
                                cancelLabel: 'Keep items',
                              }).then((ok) => {
                                if (ok) writeCart([]);
                              });
                            }}
                            className="min-h-[48px] rounded-full border-2 border-gray-200 px-6 font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                          >
                            Clear cart
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'reviews' && (
              <div className="space-y-6">
                <div className="bg-white rounded-xl shadow-sm border border-gray-100">
                  <div className="p-6 border-b">
                    <h2 className="text-2xl font-bold text-gray-900">Rate Your Purchases</h2>
                    <p className="text-sm text-gray-600 mt-1">Only delivered items can be reviewed.</p>
                  </div>
                  <div className="p-6">
                    {reviewableItems.length === 0 ? (
                      <p className="text-gray-600 text-sm">
                        Nothing to review yet. Items become reviewable once an order is marked delivered.
                      </p>
                    ) : (
                      <div className="space-y-4">
                        {reviewableItems.map((item) => {
                          const draft = reviewDrafts[item.product_id] || { rating: 5, comment: '', photos: [] };
                          const productInfo = orderedProducts[item.product_id];
                          const shopName = productInfo?.seller_id ? shopNames[productInfo.seller_id] : null;

                          return (
                            <div key={item.product_id} className="border border-gray-100 rounded-xl p-4">
                              <div className="mb-3 flex items-center gap-3">
                                <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg bg-gray-100">
                                  {productInfo?.image_url ? (
                                    <img
                                      src={productInfo.image_url}
                                      alt={item.product_name}
                                      className="h-full w-full object-cover"
                                    />
                                  ) : (
                                    <div className="flex h-full items-center justify-center text-[10px] text-gray-400">
                                      No image
                                    </div>
                                  )}
                                </div>

                                <div className="min-w-0">
                                  <p className="font-semibold text-gray-900">{item.product_name}</p>
                                  {shopName && (
                                    <p className="text-xs text-gray-500">
                                      Sold by <span className="font-medium text-blue-600">{shopName}</span>
                                    </p>
                                  )}
                                  {describeSelection(item.options) && (
                                    <p className="text-xs text-gray-500">{describeSelection(item.options)}</p>
                                  )}
                                  <p className="text-xs text-gray-500">
                                    Order {formatOrderNumber(item.orderId)} · {item.quantity} x ₱
                                    {Number(item.price).toFixed(2)}
                                  </p>
                                </div>
                              </div>
                              <StarPicker
                                value={draft.rating}
                                onChange={(rating) =>
                                  setReviewDrafts((prev) => ({
                                    ...prev,
                                    [item.product_id]: { ...draft, rating },
                                  }))
                                }
                              />
                              <textarea
                                value={draft.comment}
                                onChange={(e) =>
                                  setReviewDrafts((prev) => ({
                                    ...prev,
                                    [item.product_id]: { ...draft, comment: e.target.value },
                                  }))
                                }
                                rows="3"
                                maxLength={1000}
                                placeholder="How was the product?"
                                className="w-full mt-2 px-3 py-2 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                              />
                              {/* Photos of the product as it arrived */}
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                {(draft.photos || []).map((photo, index) => (
                                  <div key={photo.preview} className="relative">
                                    <img src={photo.preview} alt="" className="h-16 w-16 rounded-lg object-cover" />
                                    <button
                                      type="button"
                                      onClick={() => removeReviewPhoto(item.product_id, index)}
                                      aria-label={`Remove photo ${index + 1}`}
                                      className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-gray-800 text-white shadow hover:bg-black"
                                    >
                                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                                      </svg>
                                    </button>
                                  </div>
                                ))}

                                {(draft.photos || []).length < MAX_REVIEW_PHOTOS && (
                                  <>
                                    {/* `capture` asks the phone for its camera
                                        rather than its gallery; a laptop opens
                                        the usual file picker instead. */}
                                    <label
                                      title="Take a photo"
                                      className="flex h-16 w-16 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-blue-200 bg-blue-50 text-blue-600 transition-colors hover:border-blue-500 hover:bg-blue-100"
                                    >
                                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                                      </svg>
                                      <span className="text-[10px] font-semibold">Camera</span>
                                      <input
                                        type="file"
                                        accept="image/*"
                                        capture="environment"
                                        onChange={(event) => {
                                          addReviewPhotos(item.product_id, event.target.files);
                                          event.target.value = '';
                                        }}
                                        className="hidden"
                                      />
                                    </label>

                                    <label
                                      title="Choose photos"
                                      className="flex h-16 w-16 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-dashed border-gray-300 text-gray-500 transition-colors hover:border-blue-500 hover:text-blue-600"
                                    >
                                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                      </svg>
                                      <span className="text-[10px] font-semibold">Gallery</span>
                                      <input
                                        type="file"
                                        accept="image/*"
                                        multiple
                                        onChange={(event) => {
                                          addReviewPhotos(item.product_id, event.target.files);
                                          event.target.value = '';
                                        }}
                                        className="hidden"
                                      />
                                    </label>
                                  </>
                                )}
                              </div>
                              <p className="mt-1 text-xs text-gray-500">
                                {(draft.photos || []).length}/{MAX_REVIEW_PHOTOS} photos
                              </p>

                              <div className="mt-2 flex items-center justify-between gap-3">
                                <button
                                  onClick={() => submitReview(item)}
                                  disabled={savingReview}
                                  className="min-h-[44px] px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
                                >
                                  {savingReview ? 'Saving...' : 'Submit Review'}
                                </button>
                                <span className="text-xs text-gray-500">{(draft.comment || '').length}/1000</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-100">
                  <div className="p-6 border-b">
                    <h3 className="text-lg font-bold text-gray-900">My Reviews</h3>
                  </div>
                  <div className="p-6">
                    {reviews.length === 0 ? (
                      <p className="text-gray-600 text-sm">You have not written any reviews yet.</p>
                    ) : (
                      <div className="space-y-3">
                        {reviews.map((review) => {
                          const purchase = purchaseByProduct.get(review.product_id);
                          const image = productImageById.get(review.product_id);

                          return (
                            <div key={review.id} className="flex gap-4 rounded-lg border border-gray-100 p-4">
                              <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg bg-gray-100">
                                {image ? (
                                  <img src={image} alt={purchase?.name || 'Product'} className="h-full w-full object-cover" />
                                ) : (
                                  <div className="flex h-full items-center justify-center text-[10px] text-gray-400">
                                    No image
                                  </div>
                                )}
                              </div>

                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="truncate font-semibold text-gray-900">
                                      {purchase?.name || 'Product no longer listed'}
                                    </p>
                                    {purchase && (
                                      <p className="text-xs text-gray-500">
                                        Order{' '}
                                        <span className="font-mono font-semibold text-blue-600">
                                          {formatOrderNumber(purchase.orderId)}
                                        </span>{' '}
                                        · {purchase.quantity} x ₱{purchase.price.toFixed(2)} · bought{' '}
                                        {new Date(purchase.orderDate).toLocaleDateString('en-PH', {
                                          dateStyle: 'medium',
                                        })}
                                      </p>
                                    )}
                                  </div>
                                  <span className="text-xs text-gray-500">
                                    Reviewed{' '}
                                    {new Date(review.created_at).toLocaleDateString('en-PH', { dateStyle: 'medium' })}
                                  </span>
                                </div>

                                <span className="mt-1 block text-yellow-500">
                                  {'★'.repeat(review.rating)}
                                  <span className="text-gray-300">{'★'.repeat(5 - review.rating)}</span>
                                </span>

                                <p className="mt-1 text-sm text-gray-700">{review.comment || 'No comment'}</p>

                                {Array.isArray(review.photos) && review.photos.length > 0 && (
                                  <ul className="mt-2 flex flex-wrap gap-2">
                                    {review.photos.map((url) => (
                                      <li key={url}>
                                        <a href={url} target="_blank" rel="noopener noreferrer">
                                          <img
                                            src={url}
                                            alt="Your photo"
                                            className="h-14 w-14 rounded-lg border border-gray-200 object-cover transition-transform hover:scale-105"
                                          />
                                        </a>
                                      </li>
                                    ))}
                                  </ul>
                                )}

                                {review.product_id && (
                                  <Link
                                    href={`/shop?product=${review.product_id}`}
                                    className="mt-2 inline-block text-xs font-semibold text-blue-600 hover:text-blue-700"
                                  >
                                    View product →
                                  </Link>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'rewards' && (
              <div className="space-y-6">
                <div className="rounded-2xl bg-gradient-to-r from-yellow-400 to-yellow-500 p-6 text-white sm:p-8">
                  <p className="text-sm font-semibold uppercase tracking-wide text-yellow-50">Your reward points</p>
                  <p className="mt-1 text-5xl font-bold">{points}</p>
                  <p className="mt-2 text-sm text-yellow-50">
                    You earn 10 points for every ₱100 of goods. Points are returned if an order is cancelled.
                  </p>
                </div>

                <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
                  <div className="border-b p-6">
                    <h3 className="text-lg font-bold text-gray-900">Points History</h3>
                    <p className="mt-1 text-sm text-gray-600">Every time you earned points, newest first.</p>
                  </div>
                  <div className="p-6">
                    {pointsHistory.length === 0 ? (
                      <div className="py-10 text-center">
                        <p className="text-gray-600">No points yet.</p>
                        <Link
                          href="/shop"
                          className="mt-4 inline-flex min-h-[44px] items-center rounded-lg bg-blue-600 px-6 font-semibold text-white transition-colors hover:bg-blue-700"
                        >
                          Start Shopping
                        </Link>
                      </div>
                    ) : (
                      <ul className="divide-y">
                        {pointsHistory.map((entry) => (
                          <li key={entry.id} className="flex items-center justify-between gap-4 py-3">
                            <div className="min-w-0">
                              <p className="font-semibold text-gray-900">{REWARD_SOURCES[entry.subsystem_source] || 'Points earned'}</p>
                              <p className="text-xs text-gray-500">
                                {new Date(entry.created_at).toLocaleString('en-PH', {
                                  dateStyle: 'medium',
                                  timeStyle: 'short',
                                })}
                              </p>
                            </div>
                            <span className="flex-shrink-0 rounded-full bg-yellow-100 px-3 py-1 text-sm font-bold text-yellow-700">
                              +{entry.points_earned}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'settings' && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100">
                <div className="p-6 border-b">
                  <h2 className="text-2xl font-bold text-gray-900">Settings</h2>
                  <p className="text-sm text-gray-600 mt-1">
                    Your details, your password and your account, all in one place.
                  </p>
                </div>
                <div className="p-6 space-y-6">
                  {/* My details, which used to be a tab of its own */}
                  <div className="p-4 border border-gray-200 rounded-lg">
                    <h3 className="font-semibold text-gray-900 mb-1">My Profile</h3>
                    <p className="mb-4 text-sm text-gray-600">
                      Your name, picture and where your orders are delivered.
                    </p>
                  <div className="space-y-4">
                    <div className="border-b pb-5">
                      <p className="mb-3 text-sm font-semibold text-gray-700">Profile Picture</p>
                      <AvatarUpload
                        userId={user?.id}
                        url={profile?.avatar_url}
                        name={profile?.full_name}
                        email={user?.email}
                        onChange={(url) => setProfile((prev) => ({ ...(prev || {}), avatar_url: url }))}
                      />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label htmlFor="profileFirstName" className="block text-sm font-semibold text-gray-700 mb-2">
                          First Name
                        </label>
                        <input
                          id="profileFirstName"
                          type="text"
                          value={profileForm.first_name}
                          onChange={(e) => setProfileForm({ ...profileForm, first_name: sanitizeName(e.target.value) })}
                          autoComplete="given-name"
                          maxLength={60}
                          className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="Juan"
                        />
                      </div>
                      <div>
                        <label htmlFor="profileLastName" className="block text-sm font-semibold text-gray-700 mb-2">
                          Last Name
                        </label>
                        <input
                          id="profileLastName"
                          type="text"
                          value={profileForm.last_name}
                          onChange={(e) => setProfileForm({ ...profileForm, last_name: sanitizeName(e.target.value) })}
                          autoComplete="family-name"
                          maxLength={60}
                          className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="Dela Cruz"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Email</label>
                      <input
                        type="email"
                        value={profile?.email || user?.email || ''}
                        disabled
                        className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl bg-gray-50"
                      />
                      <p className="text-xs text-gray-500 mt-1">Your login email cannot be changed here.</p>
                    </div>
                    <div>
                      <label htmlFor="profilePhone" className="block text-sm font-semibold text-gray-700 mb-2">
                        Mobile Number
                      </label>
                      <input
                        id="profilePhone"
                        type="tel"
                        inputMode="numeric"
                        value={profileForm.phone}
                        onChange={(e) => setProfileForm({ ...profileForm, phone: sanitizePhone(e.target.value) })}
                        maxLength={11}
                        className="w-full min-h-[44px] px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="09171234567"
                      />
                      <p className="mt-1 text-xs text-gray-500">{PHONE_HINT}</p>
                    </div>
                    <div>
                      <label htmlFor="profileGender" className="block text-sm font-semibold text-gray-700 mb-2">
                        Gender
                      </label>
                      <select
                        id="profileGender"
                        value={profileForm.gender}
                        onChange={(e) => setProfileForm({ ...profileForm, gender: e.target.value })}
                        className="w-full min-h-[44px] px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      >
                        <option value="">Prefer not to say</option>
                        <option value="female">Female</option>
                        <option value="male">Male</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Delivery Address</label>
                      <textarea
                        value={profileForm.address}
                        onChange={(e) => setProfileForm({ ...profileForm, address: e.target.value })}
                        rows="3"
                        className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="House number, street, barangay, Daet"
                      />
                    </div>
                    <button
                      onClick={saveProfile}
                      disabled={savingProfile}
                      className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50"
                    >
                      {savingProfile ? 'Saving...' : 'Save Profile'}
                    </button>
                  </div>
                  </div>

                  <div className="p-4 border border-gray-200 rounded-lg">
                    <ChangePasswordCard
                      email={user?.email}
                      description="Use your current password, or email yourself a code if you have forgotten it."
                    />
                  </div>

                  <div className="p-4 border border-gray-200 rounded-lg">
                    <h3 className="font-semibold text-gray-900 mb-2">Account Details</h3>
                    <p className="text-sm text-gray-600">Email: {user?.email}</p>
                    <p className="text-sm text-gray-600">
                    Account type: {ROLE_LABELS[role] || ROLE_LABELS.customer}
                  </p>
                    {profile?.created_at && (
                      <p className="text-sm text-gray-600">
                        Member since {new Date(profile.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
