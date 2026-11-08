'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import Link from 'next/link';

const ORDER_STEPS = [
  { key: 'pending', label: 'Placed' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'processing', label: 'Processing' },
  { key: 'shipped', label: 'Shipped' },
  { key: 'delivered', label: 'Delivered' },
];

const wishlistKey = (userId) => `wishlist:${userId}`;

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
          className={`text-2xl leading-none ${star <= value ? 'text-yellow-500' : 'text-gray-300'}`}
          aria-label={`Rate ${star} star${star > 1 ? 's' : ''}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

export default function BuyerDashboard() {
  const { user, loading: authLoading, signOut } = useAuth();
  const router = useRouter();

  const [orders, setOrders] = useState([]);
  const [profile, setProfile] = useState(null);
  const [products, setProducts] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [wishlist, setWishlist] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('home');
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingReview, setSavingReview] = useState(false);
  const [profileForm, setProfileForm] = useState({ full_name: '', phone: '', address: '' });
  const [passwordForm, setPasswordForm] = useState({ current: '', next: '', confirm: '' });
  const [reviewDrafts, setReviewDrafts] = useState({});
  const [suspended, setSuspended] = useState(false);

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
      const [profileRes, ordersRes, productsRes, reviewsRes] = await Promise.all([
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
      setProfileForm({
        full_name: profileRes.data?.full_name || '',
        phone: profileRes.data?.phone || '',
        address: profileRes.data?.address || '',
      });
      setOrders(ordersRes.data || []);
      setProducts(productsRes.data || []);
      setReviews(reviewsRes.data || []);

      try {
        const stored = localStorage.getItem(wishlistKey(user.id));
        setWishlist(stored ? JSON.parse(stored) : []);
      } catch (error) {
        console.error('Error reading wishlist:', error);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await signOut();
    // Full navigation so the shop opens fresh instead of the dashboard lingering
    window.location.href = '/shop';
  };

  const toggleWishlist = (productId) => {
    setWishlist((prev) => {
      const next = prev.includes(productId)
        ? prev.filter((id) => id !== productId)
        : [...prev, productId];

      try {
        localStorage.setItem(wishlistKey(user.id), JSON.stringify(next));
      } catch (error) {
        console.error('Error saving wishlist:', error);
      }

      return next;
    });
  };

  const saveProfile = async () => {
    setSavingProfile(true);

    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: profileForm.full_name,
          phone: profileForm.phone || null,
          address: profileForm.address || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      if (error) {
        if (error.message?.includes('phone') || error.message?.includes('address')) {
          alert('Saving an address needs the phone/address columns. Re-run supabase-admin-policies.sql in Supabase.');
          return;
        }
        throw error;
      }

      setProfile((prev) => ({ ...prev, ...profileForm }));
      alert('Profile updated!');
    } catch (error) {
      console.error('Error saving profile:', error);
      alert('Failed to update profile: ' + error.message);
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async () => {
    if (passwordForm.next.length < 6) {
      alert('New password must be at least 6 characters.');
      return;
    }

    if (passwordForm.next !== passwordForm.confirm) {
      alert('New passwords do not match.');
      return;
    }

    try {
      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: passwordForm.current,
      });

      if (verifyError) {
        alert('Current password is incorrect.');
        return;
      }

      const { error } = await supabase.auth.updateUser({ password: passwordForm.next });
      if (error) throw error;

      setPasswordForm({ current: '', next: '', confirm: '' });
      alert('Password updated!');
    } catch (error) {
      console.error('Error changing password:', error);
      alert('Failed to change password: ' + error.message);
    }
  };

  const submitReview = async (item) => {
    const draft = reviewDrafts[item.product_id] || { rating: 5, comment: '' };
    setSavingReview(true);

    try {
      const { error } = await supabase.from('shop_reviews').insert({
        product_id: item.product_id,
        user_id: user.id,
        rating: Number(draft.rating) || 5,
        comment: draft.comment || null,
      });

      if (error) throw error;

      const { data } = await supabase
        .from('shop_reviews')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      setReviews(data || []);
      setReviewDrafts((prev) => ({ ...prev, [item.product_id]: { rating: 5, comment: '' } }));
      alert('Thank you for your review!');
    } catch (error) {
      console.error('Error saving review:', error);
      alert('Failed to save review: ' + error.message);
    } finally {
      setSavingReview(false);
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
  const wishlistProducts = products.filter((product) => wishlist.includes(product.id));
  const reviewedProductIds = new Set(reviews.map((review) => review.product_id));

  // Delivered items this buyer can still review (one entry per product)
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
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-4">
              <Link href="/shop" className="text-2xl font-bold">
                CONNECT-Daet
              </Link>
              <span className="px-3 py-1 bg-white/20 text-white text-xs font-semibold rounded-full">
                Buyer
              </span>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">{profile?.full_name || user?.email}</p>
                  <p className="text-xs text-white/80">Buyer</p>
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-medium transition-colors"
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
              <nav className="flex flex-col">
                <button
                  onClick={() => setActiveTab('home')}
                  className={`flex items-center gap-3 px-6 py-4 text-left font-medium transition-colors ${
                    activeTab === 'home'
                      ? 'bg-blue-50 text-blue-600 border-l-4 border-blue-600'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                  </svg>
                  Home
                </button>

                <button
                  onClick={() => setActiveTab('orders')}
                  className={`flex items-center gap-3 px-6 py-4 text-left font-medium transition-colors ${
                    activeTab === 'orders'
                      ? 'bg-blue-50 text-blue-600 border-l-4 border-blue-600'
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

                <Link
                  href="/shop?cart=1"
                  className="flex items-center gap-3 px-6 py-4 text-left font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                  My Cart
                </Link>

                <button
                  onClick={() => setActiveTab('wishlist')}
                  className={`flex items-center gap-3 px-6 py-4 text-left font-medium transition-colors ${
                    activeTab === 'wishlist'
                      ? 'bg-blue-50 text-blue-600 border-l-4 border-blue-600'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                  </svg>
                  Wishlist
                  {wishlistProducts.length > 0 && (
                    <span className="ml-auto px-2 py-1 bg-pink-100 text-pink-600 text-xs font-bold rounded-full">
                      {wishlistProducts.length}
                    </span>
                  )}
                </button>

                <button
                  onClick={() => setActiveTab('reviews')}
                  className={`flex items-center gap-3 px-6 py-4 text-left font-medium transition-colors ${
                    activeTab === 'reviews'
                      ? 'bg-blue-50 text-blue-600 border-l-4 border-blue-600'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                  My Reviews
                </button>

                <button
                  onClick={() => setActiveTab('profile')}
                  className={`flex items-center gap-3 px-6 py-4 text-left font-medium transition-colors ${
                    activeTab === 'profile'
                      ? 'bg-blue-50 text-blue-600 border-l-4 border-blue-600'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  My Profile
                </button>

                <button
                  onClick={() => setActiveTab('settings')}
                  className={`flex items-center gap-3 px-6 py-4 text-left font-medium transition-colors ${
                    activeTab === 'settings'
                      ? 'bg-blue-50 text-blue-600 border-l-4 border-blue-600'
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
                  className="flex items-center gap-3 px-6 py-4 text-left font-medium text-red-600 hover:bg-red-50 transition-colors border-t"
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
            {activeTab === 'home' && (
              <div className="space-y-6">
                {/* Big Deals Banner */}
                <div className="bg-gradient-to-r from-blue-500 to-blue-600 rounded-2xl p-8 text-white relative overflow-hidden">
                  <div className="relative z-10">
                    <h2 className="text-3xl font-bold mb-2">Big Deals</h2>
                    <p className="text-xl mb-4">Up to 50% OFF</p>
                    <Link
                      href="/shop"
                      className="inline-block px-6 py-3 bg-white text-blue-600 font-bold rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      Shop Now →
                    </Link>
                  </div>
                  <div className="absolute right-0 top-0 opacity-20">
                    <svg className="w-64 h-64" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M3 1a1 1 0 000 2h1.22l.305 1.222a.997.997 0 00.01.042l1.358 5.43-.893.892C3.74 11.846 4.632 14 6.414 14H15a1 1 0 000-2H6.414l1-1H14a1 1 0 00.894-.553l3-6A1 1 0 0017 3H6.28l-.31-1.243A1 1 0 005 1H3zM16 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM6.5 18a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />
                    </svg>
                  </div>
                </div>

                {/* Order Status */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-bold text-gray-900">My Order Status</h3>
                    <button onClick={() => setActiveTab('orders')} className="text-blue-600 text-sm font-medium hover:text-blue-700">
                      View All Orders →
                    </button>
                  </div>
                  <div className="grid grid-cols-4 gap-4">
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

                {/* Recommended Products */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-bold text-gray-900">Recommended For You</h3>
                    <Link href="/shop" className="text-blue-600 text-sm font-medium hover:text-blue-700">
                      See More →
                    </Link>
                  </div>

                  {products.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                      <p className="mb-4">No products available right now.</p>
                      <Link href="/shop" className="inline-block px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors">
                        Browse Products
                      </Link>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      {products.slice(0, 12).map((product) => (
                        <div key={product.id} className="border border-gray-100 rounded-xl overflow-hidden bg-white">
                          <Link href="/shop" className="block h-32 bg-gray-100 overflow-hidden">
                            {product.image_url ? (
                              <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">No image</div>
                            )}
                          </Link>
                          <div className="p-3">
                            <p className="font-semibold text-sm text-gray-900 line-clamp-2 min-h-[2.5rem]">{product.name}</p>
                            <p className="text-blue-600 font-bold mt-1">₱{Number(product.price).toFixed(2)}</p>
                            <div className="flex gap-2 mt-3">
                              <Link
                                href="/shop"
                                className="flex-1 text-center text-xs bg-blue-600 text-white rounded-lg py-2 font-semibold hover:bg-blue-700 transition-colors"
                              >
                                View
                              </Link>
                              <button
                                onClick={() => toggleWishlist(product.id)}
                                aria-label="Toggle wishlist"
                                className={`w-9 rounded-lg text-lg leading-none transition-colors ${
                                  wishlist.includes(product.id)
                                    ? 'bg-pink-100 text-pink-600'
                                    : 'bg-gray-100 text-gray-400 hover:text-pink-500'
                                }`}
                              >
                                ♥
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'orders' && (
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
                        <div key={order.id} className="border border-gray-200 rounded-lg p-6 hover:border-blue-300 transition-colors">
                          <div className="flex justify-between items-start mb-4">
                            <div>
                              <p className="text-sm text-gray-600">Order ID: <span className="font-mono font-semibold text-blue-600">#{order.id.slice(0, 8)}</span></p>
                              <p className="text-sm text-gray-600">Placed on {new Date(order.created_at).toLocaleDateString()}</p>
                            </div>
                            <span className={`px-3 py-1 text-xs font-semibold rounded-full ${getStatusColor(order.status)}`}>
                              {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                            </span>
                          </div>

                          <OrderTracking status={order.status} />

                          <div className="border-t pt-4 mt-4">
                            <h4 className="font-semibold mb-2 text-gray-900">Items:</h4>
                            {order.shop_order_items?.map((item, idx) => (
                              <div key={idx} className="flex justify-between text-sm text-gray-600 mb-1">
                                <span>{item.product_name} x{item.quantity}</span>
                                <span className="font-semibold">₱{(item.price * item.quantity).toFixed(2)}</span>
                              </div>
                            ))}
                          </div>

                          <div className="border-t mt-4 pt-4 flex justify-between items-center">
                            <div>
                              <p className="text-sm text-gray-600">Total Amount</p>
                              <p className="text-2xl font-bold text-blue-600">₱{Number(order.total_amount).toFixed(2)}</p>
                            </div>
                            <div className="text-sm text-gray-600">
                              <p>Payment: <span className="font-semibold">{order.payment_method?.toUpperCase()}</span></p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'wishlist' && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100">
                <div className="p-6 border-b">
                  <h2 className="text-2xl font-bold text-gray-900">Wishlist</h2>
                  <p className="text-sm text-gray-600 mt-1">Saved favorites on this device.</p>
                </div>
                <div className="p-6">
                  {wishlistProducts.length === 0 ? (
                    <div className="text-center py-12">
                      <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                      </svg>
                      <h3 className="text-lg font-semibold text-gray-900 mb-2">Your Wishlist is Empty</h3>
                      <p className="text-gray-600 mb-4">Tap the ♥ on a product in Home to save it here.</p>
                      <button
                        onClick={() => setActiveTab('home')}
                        className="inline-block px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors"
                      >
                        Browse Products
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {wishlistProducts.map((product) => (
                        <div key={product.id} className="flex gap-4 border border-gray-100 rounded-xl p-4">
                          <div className="w-20 h-20 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0">
                            {product.image_url && (
                              <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-gray-900 line-clamp-2">{product.name}</p>
                            <p className="text-blue-600 font-bold">₱{Number(product.price).toFixed(2)}</p>
                            <div className="flex gap-2 mt-2">
                              <Link
                                href="/shop"
                                className="text-xs bg-blue-600 text-white rounded-lg px-3 py-1.5 font-semibold hover:bg-blue-700"
                              >
                                Shop
                              </Link>
                              <button
                                onClick={() => toggleWishlist(product.id)}
                                className="text-xs bg-gray-100 text-gray-700 rounded-lg px-3 py-1.5 font-semibold hover:bg-gray-200"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
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
                          const draft = reviewDrafts[item.product_id] || { rating: 5, comment: '' };

                          return (
                            <div key={item.product_id} className="border border-gray-100 rounded-xl p-4">
                              <p className="font-semibold text-gray-900 mb-2">{item.product_name}</p>
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
                                rows="2"
                                placeholder="How was the product?"
                                className="w-full mt-2 px-3 py-2 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                              />
                              <button
                                onClick={() => submitReview(item)}
                                disabled={savingReview}
                                className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
                              >
                                {savingReview ? 'Saving...' : 'Submit Review'}
                              </button>
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
                        {reviews.map((review) => (
                          <div key={review.id} className="border border-gray-100 rounded-lg p-4">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-yellow-500">{'★'.repeat(review.rating)}<span className="text-gray-300">{'★'.repeat(5 - review.rating)}</span></span>
                              <span className="text-xs text-gray-500">{new Date(review.created_at).toLocaleDateString()}</span>
                            </div>
                            <p className="text-sm text-gray-700">{review.comment || 'No comment'}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'profile' && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100">
                <div className="p-6 border-b">
                  <h2 className="text-2xl font-bold text-gray-900">My Profile</h2>
                  <p className="text-sm text-gray-600 mt-1">Update your personal information and delivery address.</p>
                </div>
                <div className="p-6">
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Full Name</label>
                      <input
                        type="text"
                        value={profileForm.full_name}
                        onChange={(e) => setProfileForm({ ...profileForm, full_name: e.target.value })}
                        className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="Your full name"
                      />
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
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Phone Number</label>
                      <input
                        type="tel"
                        value={profileForm.phone}
                        onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })}
                        className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="+63 XXX XXX XXXX"
                      />
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
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Reward Points</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={`${points} points`}
                          disabled
                          className="flex-1 px-4 py-3 border-2 border-gray-200 rounded-xl bg-gray-50"
                        />
                        <span className="text-2xl">🏆</span>
                      </div>
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
              </div>
            )}

            {activeTab === 'settings' && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100">
                <div className="p-6 border-b">
                  <h2 className="text-2xl font-bold text-gray-900">Settings</h2>
                  <p className="text-sm text-gray-600 mt-1">Change your password and review account details.</p>
                </div>
                <div className="p-6 space-y-6">
                  <div className="p-4 border border-gray-200 rounded-lg">
                    <h3 className="font-semibold text-gray-900 mb-3">Change Password</h3>
                    <div className="space-y-3">
                      <input
                        type="password"
                        value={passwordForm.current}
                        onChange={(e) => setPasswordForm({ ...passwordForm, current: e.target.value })}
                        placeholder="Current password"
                        className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500"
                      />
                      <input
                        type="password"
                        value={passwordForm.next}
                        onChange={(e) => setPasswordForm({ ...passwordForm, next: e.target.value })}
                        placeholder="New password"
                        className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500"
                      />
                      <input
                        type="password"
                        value={passwordForm.confirm}
                        onChange={(e) => setPasswordForm({ ...passwordForm, confirm: e.target.value })}
                        placeholder="Confirm new password"
                        className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        onClick={changePassword}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
                      >
                        Update Password
                      </button>
                    </div>
                  </div>

                  <div className="p-4 border border-gray-200 rounded-lg">
                    <h3 className="font-semibold text-gray-900 mb-2">Account Details</h3>
                    <p className="text-sm text-gray-600">Email: {user?.email}</p>
                    <p className="text-sm text-gray-600">Account type: Buyer</p>
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
