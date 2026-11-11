'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { addPoints } from '@/lib/rewards';
import { useAuth } from '@/contexts/AuthContext';
import { estimateRewardPoints, formatOrderNumber, isMissingFunction, PAYMENT_LABELS } from '@/lib/orders';
import { fetchShopSettings } from '@/lib/shopSettings';
import PaymentInstructions from './PaymentInstructions';
import { describeSelection } from '@/lib/productOptions';
import AddressFields from './AddressFields';
import { formatAddress, parseAddress } from '@/lib/philippineAddresses';
import { fetchShippingFee } from '@/lib/shipping';

const MAX_QUANTITY = 9999;

const restoreReservedStock = async ({ productId, quantity }) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data: product } = await supabase
      .from('shop_products')
      .select('stock')
      .eq('id', productId)
      .maybeSingle();

    if (!product) return;

    const currentStock = Number(product.stock) || 0;
    const { data: updated } = await supabase
      .from('shop_products')
      .update({ stock: currentStock + quantity })
      .eq('id', productId)
      .eq('stock', currentStock)
      .select('id');

    if (updated && updated.length > 0) return;
  }
};

export default function CheckoutModal({ cart, total, onClose, onSuccess, onRequireAuth }) {
  const { user, profile, isSuspended } = useAuth();
  const [step, setStep] = useState(1); // 1: Contact Info, 2: Payment, 3: Success
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifiedCart, setVerifiedCart] = useState(null);
  const [awardedPoints, setAwardedPoints] = useState(0);
  const [placedOrders, setPlacedOrders] = useState([]);
  const [placedPayment, setPlacedPayment] = useState('');
  const [shopSettings, setShopSettings] = useState(null);
  const [saveDetails, setSaveDetails] = useState(false);
  const [savedProfile, setSavedProfile] = useState({ phone: '', address: '' });
  // The address as separate parts; formData.address keeps the single line that
  // is stored on the order.
  const [addressParts, setAddressParts] = useState({
    province: '',
    city: '',
    barangay: '',
    street: '',
    landmark: '',
  });
  const [shippingFee, setShippingFee] = useState(0);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    phone: '',
    address: '',
    paymentMethod: 'gcash',
    notes: '',
  });

  // Pre-fill the customer's name, email, phone and saved delivery address so a
  // returning buyer only has to confirm them.
  useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      fullName: prev.fullName || profile?.full_name || '',
      email: prev.email || user?.email || '',
    }));
  }, [user, profile]);

  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;

    (async () => {
      const { data, error: profileError } = await supabase
        .from('profiles')
        .select('full_name, phone, address')
        .eq('id', user.id)
        .maybeSingle();

      if (cancelled || profileError || !data) return;

      setSavedProfile({ phone: data.phone || '', address: data.address || '' });
      if (data.address) setAddressParts(parseAddress(data.address));
      setFormData((prev) => ({
        ...prev,
        fullName: prev.fullName || data.full_name || '',
        phone: prev.phone || data.phone || '',
        address: prev.address || data.address || '',
      }));
      // Offer to remember the details only when nothing is saved yet
      setSaveDetails(!data.phone || !data.address);
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  // The delivery fee for this address. The database works out the real figure
  // again when the order is placed, so this is only what the customer sees.
  useEffect(() => {
    let cancelled = false;

    if (!addressParts.province) {
      setShippingFee(0);
      return undefined;
    }

    fetchShippingFee({
      province: addressParts.province,
      city: addressParts.city,
      subtotal: Number(total) || 0,
    }).then((fee) => {
      if (!cancelled) setShippingFee(fee);
    });

    return () => {
      cancelled = true;
    };
  }, [addressParts.province, addressParts.city, total]);

  // GCash / bank details the admin saved in Admin -> Settings
  useEffect(() => {
    let cancelled = false;
    fetchShopSettings().then((settings) => {
      if (!cancelled) setShopSettings(settings);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Escape closes checkout. After an order is placed it behaves like
  // "Continue Shopping" so the cart is cleared.
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape' || loading) return;
      if (step === 3 && onSuccess) onSuccess();
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [step, loading, onClose, onSuccess]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  // The Continue button is not a form submit, so nothing validates the fields otherwise
  const detailsAreValid = () => {
    if (!formData.fullName.trim()) {
      setError('Please enter your full name.');
      return false;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(formData.email.trim())) {
      setError('Please enter a valid email address, for example name@example.com.');
      return false;
    }

    if (formData.phone.replace(/\D/g, '').length < 7) {
      setError('Please enter a valid phone number.');
      return false;
    }

    if (!addressParts.province.trim()) {
      setError('Please choose your province.');
      return false;
    }

    if (!addressParts.city.trim()) {
      setError('Please choose your city or municipality.');
      return false;
    }

    if (!addressParts.barangay.trim()) {
      setError('Please choose your barangay.');
      return false;
    }

    if (addressParts.street.trim().length < 3) {
      setError('Please enter your house number and street.');
      return false;
    }

    if (formData.address.trim().length < 5) {
      setError('Please complete your delivery address.');
      return false;
    }

    return true;
  };

  const ensureAccountIsActive = async () => {
    if (!user) {
      throw new Error('Please sign in to place an order.');
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('is_suspended')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError) throw profileError;

    if (profile?.is_suspended) {
      throw new Error('This account has been suspended. Please contact CONNECT-Daet support.');
    }
  };

  /**
   * Never trust the price, stock or quantity stored in localStorage. This
   * re-reads every cart item from the database and returns the only values
   * that may be written to the order.
   */
  const verifyCart = async () => {
    if (!Array.isArray(cart) || cart.length === 0) {
      throw new Error('Your cart is empty.');
    }

    const normalized = cart.map((item) => {
      const quantity = Number(item.quantity);

      if (!item.id) {
        throw new Error('One of the items in your cart is invalid. Please remove it and try again.');
      }

      if (!Number.isInteger(quantity) || quantity <= 0 || quantity > MAX_QUANTITY) {
        throw new Error(`The quantity for ${item.name || 'an item'} is invalid. Use a whole number from 1 to ${MAX_QUANTITY}.`);
      }

      return {
        id: item.productId || item.id,
        lineId: item.lineId || item.id,
        selectedOptions: item.selectedOptions || {},
        quantity,
      };
    });

    const uniqueIds = [...new Set(normalized.map((item) => item.id))];
    const { data: products, error: productsError } = await supabase
      .from('shop_products')
      .select('id, name, price, stock, available, seller_id')
      .in('id', uniqueIds);

    if (productsError) throw productsError;

    const productById = new Map((products || []).map((product) => [product.id, product]));

    // A product must still belong to an approved, active, non-rejected seller.
    // Without this check, de-listed seller products could still be ordered.
    const sellerIds = [...new Set((products || []).map((product) => product.seller_id).filter(Boolean))];
    const sellerById = new Map();

    if (sellerIds.length > 0) {
      const loadSellers = async (includeRejected) => {
        const columns = includeRejected
          ? 'id, is_approved, is_active, is_rejected'
          : 'id, is_approved, is_active';

        return supabase.from('shop_sellers').select(columns).in('id', sellerIds);
      };

      let { data: sellers, error: sellersError } = await loadSellers(true);

      if (sellersError && /is_rejected|column .* does not exist/i.test(sellersError.message || '')) {
        const retry = await loadSellers(false);
        sellers = retry.data;
        sellersError = retry.error;
      }

      if (sellersError) throw sellersError;

      (sellers || []).forEach((seller) => {
        sellerById.set(seller.id, seller);
      });
    }

    const items = normalized.map((item) => {
      const product = productById.get(item.id);

      if (!product) {
        throw new Error('One of the products in your cart is no longer available. Please remove it and try again.');
      }

      if (product.available === false) {
        throw new Error(`${product.name} is no longer available.`);
      }

      if (product.seller_id) {
        const seller = sellerById.get(product.seller_id);
        const isRejected = Boolean(seller?.is_rejected);

        if (!seller || !seller.is_approved || seller.is_active === false || isRejected) {
          throw new Error(`${product.name} is no longer sold by an active shop. Please remove it from your cart.`);
        }
      }

      const price = Number(product.price);
      if (!Number.isFinite(price) || price <= 0) {
        throw new Error(`${product.name} has an invalid price. Please contact the seller.`);
      }

      const stock = Number(product.stock) || 0;
      if (stock < item.quantity) {
        throw new Error(`${product.name} has insufficient stock. Available: ${stock}, requested: ${item.quantity}.`);
      }

      return {
        id: product.id,
        lineId: item.lineId,
        selectedOptions: item.selectedOptions,
        name: product.name,
        seller_id: product.seller_id || null,
        price,
        stock,
        quantity: item.quantity,
        subtotal: price * item.quantity,
      };
    });

    return {
      items,
      total: items.reduce((sum, item) => sum + item.subtotal, 0),
    };
  };

  const continueToPayment = async () => {
    setError('');

    if (!detailsAreValid()) return;

    if (!user) {
      setError('Please sign in to place an order.');
      return;
    }

    if (isSuspended) {
      setError('This account has been suspended. Please contact CONNECT-Daet support.');
      return;
    }

    setVerifying(true);

    try {
      await ensureAccountIsActive();
      setVerifiedCart(await verifyCart());
      setStep(2);
    } catch (verificationError) {
      console.error('Cart verification failed:', verificationError);
      setError(verificationError.message || 'Please review your cart and try again.');
    } finally {
      setVerifying(false);
    }
  };

  // Remember phone/address on the profile so the next checkout is pre-filled.
  // Best-effort: a failure here must never affect the order.
  const saveDetailsToProfile = async (userId) => {
    if (!saveDetails) return;
    const phone = formData.phone.trim();
    const address = formData.address.trim();
    if (phone === savedProfile.phone && address === savedProfile.address) return;

    const { error: saveError } = await supabase
      .from('profiles')
      .update({ phone, address, updated_at: new Date().toISOString() })
      .eq('id', userId);

    if (saveError) {
      console.warn('Order placed, but the delivery details were not saved:', saveError.message);
    }
  };

  /**
   * Preferred checkout: place_order() in the database validates the cart
   * against live prices and stock, locks the products, creates one order per
   * shop, reduces stock and awards points in one transaction.
   * Returns null when that function is not installed yet.
   */
  const placeOrderOnServer = async () => {
    const { data, error: rpcError } = await supabase.rpc('place_order', {
      p_items: cart.map((item) => ({
        product_id: item.productId || item.id,
        quantity: Number(item.quantity),
        // What the shopper chose (colour, size...). The database checks it
        // against what the seller actually offers.
        options: item.selectedOptions && Object.keys(item.selectedOptions).length > 0
          ? item.selectedOptions
          : null,
      })),
      p_customer_name: formData.fullName.trim(),
      p_customer_email: formData.email.trim(),
      p_customer_phone: formData.phone.trim(),
      p_delivery_address: formData.address.trim(),
      p_payment_method: formData.paymentMethod,
      p_notes: formData.notes.trim() || null,
      p_province: addressParts.province || null,
      p_city: addressParts.city || null,
    });

    if (rpcError) {
      if (isMissingFunction(rpcError)) return null;
      throw new Error(rpcError.message || 'Could not place your order. Please try again.');
    }

    return data;
  };

  const handleSubmitOrder = async () => {
    if (loading) return;
    setLoading(true);
    setError('');
    let createdOrderId = null;
    const reservedStock = [];

    try {
      await ensureAccountIsActive();

      // Own the order with the authenticated session, not the React user state.
      // The context can lag behind after another tab signs in, and an order whose
      // user_id differs from auth.uid() is rejected by the RLS policy.
      const { data: { user: sessionUser }, error: sessionError } = await supabase.auth.getUser();

      if (sessionError || !sessionUser) {
        throw new Error('Your session has expired. Please sign in again.');
      }

      const serverResult = await placeOrderOnServer();

      if (serverResult) {
        const orders = Array.isArray(serverResult.orders) ? serverResult.orders : [];
        await saveDetailsToProfile(sessionUser.id);
        setPlacedOrders(orders.map((order) => ({ id: order.id, total: Number(order.total) || 0 })));
        setPlacedPayment(formData.paymentMethod);
        setVerifiedCart((previous) => ({
          items: previous?.items || cart,
          total: Number(serverResult.total) || previous?.total || 0,
        }));
        setAwardedPoints(Number(serverResult.points) || 0);
        setStep(3);
        return;
      }

      // ---------------------------------------------------------------------
      // Legacy browser-side checkout, used only until
      // supabase-checkout-security.sql has been run in Supabase.
      // ---------------------------------------------------------------------
      // Re-verify at the last moment: prices or stock may have changed while
      // the customer was typing their details.
      const orderCart = await verifyCart();
      setVerifiedCart(orderCart);

      // Reserve stock first. If any reservation fails, everything already
      // reserved is put back before the error reaches the customer.
      for (const item of orderCart.items) {
        let reserved = false;

        for (let attempt = 0; attempt < 3 && !reserved; attempt += 1) {
          const { data: currentProduct, error: fetchError } = await supabase
            .from('shop_products')
            .select('stock')
            .eq('id', item.id)
            .single();

          if (fetchError) throw fetchError;

          const currentStock = Number(currentProduct.stock) || 0;

          if (currentStock < item.quantity) {
            throw new Error(`${item.name} has insufficient stock. Available: ${currentStock}, requested: ${item.quantity}.`);
          }

          const { data: updated, error: stockError } = await supabase
            .from('shop_products')
            .update({ stock: currentStock - item.quantity })
            .eq('id', item.id)
            .eq('stock', currentStock) // optimistic locking
            .select('id');

          if (stockError) throw stockError;

          if (updated && updated.length > 0) {
            reservedStock.push({ productId: item.id, quantity: item.quantity });
            reserved = true;
          }
        }

        if (!reserved) {
          throw new Error(`${item.name} was just sold out. Please review your cart and try again.`);
        }
      }

      const { data: order, error: orderError } = await supabase
        .from('shop_orders')
        .insert({
          user_id: sessionUser.id,
          customer_name: formData.fullName.trim(),
          customer_email: formData.email.trim(),
          customer_phone: formData.phone.trim(),
          delivery_address: formData.address.trim(),
          payment_method: formData.paymentMethod,
          total_amount: orderCart.total,
          status: 'pending',
          notes: formData.notes.trim(),
        })
        .select()
        .single();

      if (orderError) throw orderError;

      createdOrderId = order.id;

      const { error: itemsError } = await supabase
        .from('shop_order_items')
        .insert(orderCart.items.map((item) => ({
          order_id: order.id,
          product_id: item.id,
          product_name: item.name,
          quantity: item.quantity,
          price: item.price,
        })));

      if (itemsError) throw itemsError;

      // Award points for the database total, never the client-side one.
      // A points failure must not destroy a paid order, so it is best-effort.
      const pointsToAward = Math.floor(orderCart.total / 100) * 10;
      let awarded = 0;

      if (pointsToAward > 0) {
        const pointsResult = await addPoints(sessionUser.id, pointsToAward, 'shop_purchase', order.id);
        if (pointsResult.success) {
          awarded = pointsToAward;
        } else {
          console.warn('Order placed but points were not awarded:', pointsResult.error);
        }
      }

      await saveDetailsToProfile(sessionUser.id);
      setPlacedOrders([{ id: order.id, total: orderCart.total }]);
      setPlacedPayment(formData.paymentMethod);
      setVerifiedCart(orderCart);
      setAwardedPoints(awarded);
      setStep(3);
    } catch (submitError) {
      console.error('Error creating order:', submitError);

      // Roll back the half-created order so nobody sees an empty order.
      if (createdOrderId) {
        const { error: cleanupError } = await supabase
          .from('shop_order_items')
          .delete()
          .eq('order_id', createdOrderId);

        if (!cleanupError) {
          await supabase.from('shop_orders').delete().eq('id', createdOrderId);
        } else {
          // Deleting is blocked: keep the order but mark it cancelled so it is
          // not fulfilled without the stock that was just released.
          await supabase
            .from('shop_orders')
            .update({ status: 'cancelled', updated_at: new Date().toISOString() })
            .eq('id', createdOrderId);
        }
      }

      for (const reservation of reservedStock.reverse()) {
        await restoreReservedStock(reservation);
      }

      setError(submitError.message || 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const summaryItems = verifiedCart?.items || cart;
  const summaryTotal = verifiedCart?.total ?? (Number(total) || 0);
  const summaryPoints = estimateRewardPoints(summaryItems);
  const orderNumbers = placedOrders.map((order) => formatOrderNumber(order.id));

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-[60] flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" aria-label="Checkout" className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Step 1: Contact Information */}
        {step === 1 && (
          <div className="p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-800">Contact Information</h2>
              <button
                onClick={onClose}
                aria-label="Close checkout"
                className="flex min-h-[44px] min-w-[44px] -m-2 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {!user && (
              <div className="mb-4 rounded-xl border-2 border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
                <p className="font-semibold mb-2">Sign in to place your order</p>
                <p className="mb-3">Orders are linked to your account so you can track them and earn reward points.</p>
                <button
                  type="button"
                  onClick={() => {
                    if (onRequireAuth) onRequireAuth();
                    onClose();
                  }}
                  className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700"
                >
                  Sign In
                </button>
              </div>
            )}

            {isSuspended && (
              <div className="mb-4 rounded-xl border-2 border-red-200 bg-red-50 p-4 text-sm text-red-800">
                This account has been suspended. Please contact CONNECT-Daet support.
              </div>
            )}

            {error && (
              <div className="mb-4 rounded-xl border-2 border-red-200 bg-red-50 p-4 text-sm text-red-800">
                {error}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  name="fullName"
                  autoComplete="name"
                  maxLength={120}
                  value={formData.fullName}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email *
                </label>
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Phone Number *
                </label>
                <input
                  type="tel"
                  name="phone"
                  autoComplete="tel"
                  inputMode="tel"
                  placeholder="09XX XXX XXXX"
                  maxLength={30}
                  value={formData.phone}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>

              <div>
                <p className="mb-3 text-sm font-semibold text-gray-900">Delivery Address *</p>
                <AddressFields
                  value={addressParts}
                  onChange={(next) => {
                    setAddressParts(next);
                    // Keep the single stored line in step with the parts
                    setFormData((prev) => ({ ...prev, address: formatAddress(next) }));
                  }}
                />
                {formData.address && (
                  <p className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                    Delivering to: <span className="font-medium text-gray-800">{formData.address}</span>
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Order Notes (Optional)
                </label>
                <textarea
                  name="notes"
                  value={formData.notes}
                  onChange={handleInputChange}
                  rows="2"
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Special instructions or requests..."
                  maxLength={1000}
                />
              </div>

              {user && (
                <label className="flex items-start gap-3 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={saveDetails}
                    onChange={(event) => setSaveDetails(event.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>Save this phone number and address to my profile for faster checkout next time</span>
                </label>
              )}
            </div>

            <button
              onClick={continueToPayment}
              disabled={verifying || !user || isSuspended}
              className="w-full mt-6 bg-blue-600 text-white py-4 rounded-full font-bold text-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              {verifying ? 'Checking prices and stock...' : 'Continue to Payment'}
            </button>
          </div>
        )}

        {/* Step 2: Payment Method */}
        {step === 2 && (
          <div className="p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-800">Payment Method</h2>
              <button
                onClick={onClose}
                aria-label="Close checkout"
                className="flex min-h-[44px] min-w-[44px] -m-2 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {error && (
              <div className="mb-4 rounded-xl border-2 border-red-200 bg-red-50 p-4 text-sm text-red-800">
                {error}
              </div>
            )}

            {/* Order Summary */}
            <div className="bg-gray-50 rounded-xl p-4 mb-6">
              <h3 className="font-semibold mb-2">Order Summary</h3>
              {summaryItems.map((item) => (
                <div key={item.lineId || item.id} className="flex justify-between gap-3 text-sm mb-1">
                  <span className="min-w-0 break-words">
                    {item.name} x{item.quantity}
                    {describeSelection(item.selectedOptions) && (
                      <span className="block text-xs text-gray-500">{describeSelection(item.selectedOptions)}</span>
                    )}
                  </span>
                  <span className="flex-shrink-0">₱{(Number(item.price) * Number(item.quantity)).toFixed(2)}</span>
                </div>
              ))}
              <div className="mt-2 flex justify-between border-t pt-2 text-sm">
                <span className="text-gray-600">Items</span>
                <span>₱{summaryTotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Delivery</span>
                <span className={shippingFee === 0 ? 'font-semibold text-green-600' : ''}>
                  {shippingFee === 0 ? 'FREE' : `₱${shippingFee.toFixed(2)}`}
                </span>
              </div>
              <div className="mt-2 flex justify-between border-t pt-2 font-bold">
                <span>Total</span>
                <span className="text-blue-600">₱{(summaryTotal + shippingFee).toFixed(2)}</span>
              </div>
              {summaryItems.some((item) => item.seller_id) && shippingFee > 0 && (
                <p className="mt-2 text-xs text-gray-500">
                  Each shop delivers separately, so the fee applies once per shop.
                </p>
              )}
            </div>

            {/* Payment Options */}
            <div className="space-y-3 mb-6">
              <label className="flex items-center p-4 border-2 rounded-xl cursor-pointer hover:bg-blue-50 transition-colors">
                <input
                  type="radio"
                  name="paymentMethod"
                  value="gcash"
                  checked={formData.paymentMethod === 'gcash'}
                  onChange={handleInputChange}
                  className="w-5 h-5 text-blue-600"
                />
                <span className="ml-3 font-medium">GCash</span>
              </label>

              <label className="flex items-center p-4 border-2 rounded-xl cursor-pointer hover:bg-blue-50 transition-colors">
                <input
                  type="radio"
                  name="paymentMethod"
                  value="cod"
                  checked={formData.paymentMethod === 'cod'}
                  onChange={handleInputChange}
                  className="w-5 h-5 text-blue-600"
                />
                <span className="ml-3 font-medium">Cash on Delivery</span>
              </label>

              <label className="flex items-center p-4 border-2 rounded-xl cursor-pointer hover:bg-blue-50 transition-colors">
                <input
                  type="radio"
                  name="paymentMethod"
                  value="bank"
                  checked={formData.paymentMethod === 'bank'}
                  onChange={handleInputChange}
                  className="w-5 h-5 text-blue-600"
                />
                <span className="ml-3 font-medium">Bank Transfer</span>
              </label>
            </div>

            {(formData.paymentMethod === 'gcash' || formData.paymentMethod === 'bank') && (
              <div className="mb-6">
                <PaymentInstructions method={formData.paymentMethod} settings={shopSettings} compact />
              </div>
            )}

            <div className="mb-6 rounded-xl border border-gray-200 p-4 text-sm text-gray-700">
              <p className="font-semibold text-gray-900 mb-1">Deliver to</p>
              <p className="break-words">{formData.fullName} · {formData.phone}</p>
              <p className="break-words whitespace-pre-line">{formData.address}</p>
              {summaryPoints > 0 && (
                <p className="mt-2 text-xs text-yellow-800">You will earn about {summaryPoints} reward points with this order.</p>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep(1)}
                disabled={loading}
                className="flex-1 bg-gray-200 text-gray-700 py-4 rounded-full font-bold hover:bg-gray-300 transition-colors disabled:opacity-50"
              >
                Back
              </button>
              <button
                onClick={handleSubmitOrder}
                disabled={loading}
                className="flex-1 bg-blue-600 text-white py-4 rounded-full font-bold hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
              >
                {loading ? 'Processing...' : 'Place Order'}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Success */}
        {step === 3 && (
          <div className="p-6 text-center">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-10 h-10 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">Order Placed Successfully!</h2>
            <p className="text-gray-600 mb-4">
              Thank you for supporting local artisans of Daet. The shop will contact you shortly to confirm your order.
            </p>
            {orderNumbers.length > 0 && (
              <div className="mb-4 rounded-xl bg-gray-50 p-4 text-sm text-gray-700">
                <p>
                  {orderNumbers.length === 1 ? 'Order number' : 'Order numbers (one per shop)'}:{' '}
                  <span className="font-mono font-semibold text-gray-900">{orderNumbers.join(', ')}</span>
                </p>
                <p className="mt-1">
                  Total: <span className="font-semibold">₱{summaryTotal.toFixed(2)}</span> · Payment:{' '}
                  <span className="font-semibold">{PAYMENT_LABELS[placedPayment] || placedPayment}</span>
                </p>
              </div>
            )}
            {(placedPayment === 'gcash' || placedPayment === 'bank') && (
              <div className="mb-4">
                <PaymentInstructions
                  method={placedPayment}
                  settings={shopSettings}
                  amount={summaryTotal}
                  orderNumbers={orderNumbers}
                />
              </div>
            )}
            {awardedPoints > 0 && (
              <div className="bg-blue-50 rounded-xl p-4 mb-6">
                <p className="text-sm text-gray-600">
                  You&apos;ve earned <span className="font-bold text-blue-600">{awardedPoints} points</span> for this purchase!
                </p>
              </div>
            )}
            <button
              onClick={() => {
                if (onSuccess) onSuccess();
                onClose();
              }}
              className="w-full bg-blue-600 text-white py-4 rounded-full font-bold hover:bg-blue-700 transition-colors"
            >
              Continue Shopping
            </button>
            <a
              href="/shop/buyer?tab=orders"
              onClick={() => {
                if (onSuccess) onSuccess();
              }}
              className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center rounded-full border-2 border-blue-600 font-bold text-blue-600 hover:bg-blue-50"
            >
              Track my order
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
