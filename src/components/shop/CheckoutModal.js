'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import {
  allocateRedemption,
  estimateRewardPoints,
  formatOrderNumber,
  isMissingFunction,
  MAX_REDEEM_SHARE,
  PAYMENT_LABELS,
  POINT_VALUE,
} from '@/lib/orders';
import { fetchShopSettings } from '@/lib/shopSettings';
import PaymentInstructions from './PaymentInstructions';
import { describeSelection } from '@/lib/productOptions';
import AddressFields from './AddressFields';
import { DEFAULT_CITY, DEFAULT_PROVINCE, formatAddress, parseAddress } from '@/lib/philippineAddresses';
import { PHONE_HINT, describeNameProblem, describePhoneProblem, sanitizeName, sanitizePhone } from '@/lib/fieldRules';
import { fetchShippingFee } from '@/lib/shipping';
import ShopPaymentPanel from './ShopPaymentPanel';
import { acceptsMethod, attachPaymentProof, fetchSellerPayments } from '@/lib/sellerPayments';
import { fetchOnlinePaymentEnabled, returnPagePath, startOnlinePayment } from '@/lib/xendit';

const MAX_QUANTITY = 9999;

export default function CheckoutModal({
  cart,
  total,
  onClose,
  onSuccess,
  onRequireAuth,
  variant = 'modal',
}) {
  const isPage = variant === 'page';
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
    province: DEFAULT_PROVINCE,
    city: DEFAULT_CITY,
    barangay: '',
    street: '',
    landmark: '',
  });
  // Delivery fee per shop: { [sellerId | 'platform']: fee }
  const [shippingFees, setShippingFees] = useState({});
  const shippingFee = Object.values(shippingFees).reduce((sum, fee) => sum + (Number(fee) || 0), 0);
  // The GCash / bank details of every shop in the basket, and the receipt the
  // customer attaches for each of them: { [sellerId]: { url, reference } }
  const [sellerPayments, setSellerPayments] = useState({});
  const [receipts, setReceipts] = useState({});
  // Online payment through Xendit (GCash, Maya, cards, QR Ph, GrabPay...)
  const [onlineEnabled, setOnlineEnabled] = useState(false);
  const [placedCheckoutId, setPlacedCheckoutId] = useState(null);
  const [paymentStartError, setPaymentStartError] = useState('');
  const [startingPayment, setStartingPayment] = useState(false);
  // Delivered to an address, or picked up at the shop (no delivery fee)
  const [fulfillment, setFulfillment] = useState('delivery');
  const isPickupOrder = fulfillment === 'pickup';
  // CONNECT-Daet reward points the customer has, and whether to spend them
  const [pointsBalance, setPointsBalance] = useState(0);
  const [usePoints, setUsePoints] = useState(false);
  // What the database actually charged, once the order is placed
  const [placedRedeemed, setPlacedRedeemed] = useState(0);
  const topRef = useRef(null);

  /**
   * Show the problem. The form is taller than the window, so the message at
   * the top is easy to miss: bring it back into view.
   */
  const reportError = useCallback((message) => {
    setError(message);

    setTimeout(() => {
      const node = topRef.current;
      if (!node) return;

      if (typeof node.scrollTo === 'function') node.scrollTo({ top: 0, behavior: 'smooth' });
      node.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }, []);
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
        .select('full_name, phone, address, points')
        .eq('id', user.id)
        .maybeSingle();

      if (cancelled || profileError || !data) return;

      setPointsBalance(Math.max(0, Math.floor(Number(data.points) || 0)));
      setSavedProfile({ phone: data.phone || '', address: data.address || '' });
      if (data.address) {
        const parsed = parseAddress(data.address);
        setAddressParts({ ...parsed, province: DEFAULT_PROVINCE, city: DEFAULT_CITY });
      }
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

  // The delivery fee for this address. Every shop delivers separately, so
  // place_order() charges one fee per shop, each worked out on that shop's own
  // subtotal (a free-delivery threshold applies per shop). The same is asked
  // for here so the total the customer sees is the total they are charged.
  const groupSubtotalsKey = JSON.stringify(
    Object.entries(
      (verifiedCart?.items || cart).reduce((groups, item) => {
        const key = item.seller_id || 'platform';
        groups[key] = (groups[key] || 0) + (Number(item.price) || 0) * (Number(item.quantity) || 0);
        return groups;
      }, {})
    ).sort(([a], [b]) => a.localeCompare(b))
  );

  useEffect(() => {
    let cancelled = false;
    const groups = JSON.parse(groupSubtotalsKey);

    // Picking up at the shop costs nothing to deliver.
    if (isPickupOrder || !addressParts.province || groups.length === 0) {
      setShippingFees({});
      return undefined;
    }

    Promise.all(
      groups.map(([key, subtotal]) =>
        fetchShippingFee({ province: addressParts.province, city: addressParts.city, subtotal }).then(
          (fee) => [key, fee]
        )
      )
    ).then((entries) => {
      if (!cancelled) setShippingFees(Object.fromEntries(entries));
    });

    return () => {
      cancelled = true;
    };
  }, [addressParts.province, addressParts.city, groupSubtotalsKey, isPickupOrder]);

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

  // Offer online payment only when the server has Xendit keys, and make it
  // the default choice when it is there.
  useEffect(() => {
    let cancelled = false;
    fetchOnlinePaymentEnabled().then((enabled) => {
      if (cancelled) return;
      setOnlineEnabled(enabled);
      if (enabled) {
        setFormData((prev) => (prev.paymentMethod === 'gcash' ? { ...prev, paymentMethod: 'xendit' } : prev));
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Send the customer to Xendit for an order that has been placed. */
  const goToOnlinePayment = async (checkoutId) => {
    setStartingPayment(true);
    setPaymentStartError('');
    try {
      const url = await startOnlinePayment(checkoutId);
      if (onSuccess) await onSuccess();
      window.location.assign(url || returnPagePath(checkoutId));
    } catch (paymentError) {
      setPaymentStartError(paymentError.message || 'Could not start the online payment.');
      setStartingPayment(false);
    }
  };

  // ...and the details each shop in this basket saved for itself.
  const sellerIdKey = Array.from(new Set(cart.map((item) => item.seller_id).filter(Boolean)))
    .sort()
    .join(',');

  useEffect(() => {
    let cancelled = false;
    const ids = sellerIdKey ? sellerIdKey.split(',') : [];

    fetchSellerPayments(ids).then((map) => {
      if (!cancelled) setSellerPayments(map);
    });

    return () => {
      cancelled = true;
    };
  }, [sellerIdKey]);

  // Take the bought items out of the cart the moment the order exists. Waiting
  // for "Continue Shopping" left them in the cart whenever the customer
  // closed the tab or used the header links, ready to be bought twice.
  const clearedCartRef = useRef(false);
  useEffect(() => {
    if (step !== 3 || placedOrders.length === 0 || clearedCartRef.current) return;
    clearedCartRef.current = true;
    if (onSuccess) onSuccess();
  }, [step, placedOrders.length, onSuccess]);

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

    // The name box takes letters and the phone box digits, as they are typed.
    const cleaned =
      name === 'fullName' ? sanitizeName(value) : name === 'phone' ? sanitizePhone(value) : value;

    setFormData((prev) => ({ ...prev, [name]: cleaned }));
  };

  // The Continue button is not a form submit, so nothing validates the fields otherwise
  const detailsAreValid = () => {
    const nameProblem = describeNameProblem(formData.fullName, 'full name');
    if (nameProblem) {
      reportError(nameProblem);
      return false;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(formData.email.trim())) {
      reportError('Please enter a valid email address, for example name@example.com.');
      return false;
    }

    const phoneProblem = describePhoneProblem(formData.phone);
    if (phoneProblem) {
      reportError(phoneProblem);
      return false;
    }

    // A pickup order needs no delivery address.
    if (isPickupOrder) return true;

    if (!addressParts.barangay.trim()) {
      reportError('Please choose your barangay.');
      return false;
    }

    if (addressParts.street.trim().length < 3) {
      reportError('Please enter your house number and street.');
      return false;
    }

    if (formData.address.trim().length < 5) {
      reportError('Please complete your delivery address.');
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
      reportError('Please sign in to place an order.');
      return;
    }

    if (isSuspended) {
      reportError('This account has been suspended. Please contact CONNECT-Daet support.');
      return;
    }

    setVerifying(true);

    try {
      await ensureAccountIsActive();
      setVerifiedCart(await verifyCart());
      setStep(2);
    } catch (verificationError) {
      console.error('Cart verification failed:', verificationError);
      reportError(verificationError.message || 'Please review your cart and try again.');
    } finally {
      setVerifying(false);
    }
  };

  // Remember phone/address on the profile so the next checkout is pre-filled.
  // Best-effort: a failure here must never affect the order.
  const saveDetailsToProfile = async (userId) => {
    if (!saveDetails) return;
    const phone = formData.phone.trim();
    // A pickup order has no delivery address to remember.
    const address = isPickupOrder ? savedProfile.address : formData.address.trim();
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
   * The only way an order is placed: place_order() in the database validates
   * the cart against live prices and stock, locks the products, creates one
   * order per shop with its items, reduces stock and spends any redeemed
   * points in ONE transaction. Either all of it happens or none of it does.
   * Reward points are earned later, when the order is delivered / picked up.
   */
  const placeOrderOnServer = async () => {
    const args = {
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
      p_delivery_address: isPickupOrder ? null : formData.address.trim(),
      p_payment_method: formData.paymentMethod,
      p_notes: formData.notes.trim() || null,
      p_province: isPickupOrder ? null : addressParts.province || null,
      p_city: isPickupOrder ? null : addressParts.city || null,
    };

    // Sent only when used, so an ordinary delivery order still works on a
    // database that has not run supabase-cart-pickup-redemption.sql.
    const needsNewCheckout = isPickupOrder || redemption.total > 0;
    if (needsNewCheckout) {
      args.p_fulfillment = fulfillment;
      args.p_redeem_points = redemption.total;
    }

    const { data, error: rpcError } = await supabase.rpc('place_order', args);

    if (rpcError) {
      if (isMissingFunction(rpcError)) {
        throw new Error(
          needsNewCheckout
            ? 'Store pickup and paying with points are not switched on yet. Choose delivery without points, or ask the admin to run supabase-cart-pickup-redemption.sql.'
            : 'Checkout is not set up yet. Ask the admin to run supabase-checkout-security.sql in Supabase.'
        );
      }
      throw new Error(rpcError.message || 'Could not place your order. Please try again.');
    }

    return data;
  };

  const handleSubmitOrder = async () => {
    if (loading) return;
    setLoading(true);
    setError('');

    try {
      await ensureAccountIsActive();

      // Own the order with the authenticated session, not the React user state.
      // The context can lag behind after another tab signs in.
      const { data: { user: sessionUser }, error: sessionError } = await supabase.auth.getUser();

      if (sessionError || !sessionUser) {
        throw new Error('Your session has expired. Please sign in again.');
      }

      const serverResult = await placeOrderOnServer();
      const orders = Array.isArray(serverResult?.orders) ? serverResult.orders : [];

      await saveDetailsToProfile(sessionUser.id);

      setPlacedOrders(orders.map((order) => ({ id: order.id, total: Number(order.total) || 0 })));
      setPlacedPayment(formData.paymentMethod);
      setPlacedRedeemed(Number(serverResult?.points_redeemed) || 0);
      if (Number(serverResult?.points_redeemed) > 0) {
        setPointsBalance((balance) => Math.max(0, balance - Number(serverResult.points_redeemed)));
      }
      setVerifiedCart((previous) => ({
        items: previous?.items || cart,
        total: previous?.total || 0,
        // What the customer is charged, delivery included and points taken off
        charged: Number(serverResult?.total) || 0,
      }));
      setAwardedPoints(Number(serverResult?.points) || 0);

      if (formData.paymentMethod === 'xendit') {
        setPlacedCheckoutId(serverResult.checkout_id);

        // The order is placed. If Xendit cannot be reached, the customer
        // lands on the success step with a "Pay now" button instead.
        try {
          const url = await startOnlinePayment(serverResult.checkout_id);
          if (onSuccess) await onSuccess();
          window.location.assign(
            url || returnPagePath(serverResult.checkout_id)
          );
          return;
        } catch (paymentError) {
          setPaymentStartError(paymentError.message || 'Could not start the online payment.');
          setStep(3);
          return;
        }
      }

      // Put each receipt on the order for the shop it was paid to. The order
      // itself is already placed, so a failure here is worth a warning in the
      // console, never losing the order.
      for (const order of orders) {
        const receipt = receipts[order.seller_id || 'platform'];
        if (receipt?.url) {
          await attachPaymentProof(order.id, receipt.url, receipt.reference || null);
        }
      }

      setStep(3);
    } catch (submitError) {
      console.error('Error creating order:', submitError);
      reportError(submitError.message || 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const summaryItems = verifiedCart?.items || cart;
  const summaryTotal = verifiedCart?.total ?? (Number(total) || 0);

  // Goods subtotal per shop, the unit place_order() splits orders by.
  const subtotalsBySeller = summaryItems.reduce((groups, item) => {
    const key = item.seller_id || 'platform';
    groups[key] = (groups[key] || 0) + (Number(item.price) || 0) * (Number(item.quantity) || 0);
    return groups;
  }, {});

  // Reward points spent on this checkout: as many as the customer has, up to
  // half of each shop's goods (the same rule place_order() applies).
  const redemption = allocateRedemption(subtotalsBySeller, usePoints ? pointsBalance : 0);
  const redeemableNow = allocateRedemption(subtotalsBySeller, pointsBalance).total;
  const pointsDiscount = redemption.total * POINT_VALUE;
  const amountDue = Math.max(0, summaryTotal + shippingFee - pointsDiscount);
  const summaryPoints = estimateRewardPoints(summaryItems, redemption.bySeller);
  // After the order is placed: exactly what the database charged.
  const chargedTotal = Number(verifiedCart?.charged) || amountDue;
  const orderNumbers = placedOrders.map((order) => formatOrderNumber(order.id));

  // One group per shop: what is owed to it, and how it wants to be paid. Each
  // shop delivers separately, so the delivery fee belongs to each group.
  const paymentGroups = Object.values(
    summaryItems.reduce((groups, item) => {
      const key = item.seller_id || 'platform';
      const line = (Number(item.price) || 0) * (Number(item.quantity) || 0);
      const details = sellerPayments[item.seller_id] || null;

      if (!groups[key]) {
        groups[key] = {
          key,
          sellerId: item.seller_id || null,
          name: details?.business_name || item.sellerName || 'CONNECT-Daet',
          payment: details,
          amount: 0,
        };
      }

      groups[key].amount += line;
      return groups;
    }, {})
  ).map((group) => ({
    ...group,
    amount:
      group.amount +
      (Number(shippingFees[group.key]) || 0) -
      (Number(redemption.bySeller[group.key]) || 0) * POINT_VALUE,
  }));

  /**
   * A shop that has not saved its GCash number cannot be paid by GCash, so
   * that choice is hidden while anything from that shop is in the basket.
   * Cash on delivery always works.
   */
  const methodIsAvailable = (method) => {
    if (method === 'cod') return true;
    // Nothing saved anywhere yet: fall back to the platform-wide details the
    // admin keeps in Admin -> Settings, exactly as before.
    if (Object.keys(sellerPayments).length === 0) return true;
    return paymentGroups.every((group) => !group.payment || acceptsMethod(group.payment, method));
  };

  const needsReceipt = formData.paymentMethod === 'gcash' || formData.paymentMethod === 'bank';
  const shopsWithDetails = paymentGroups.filter((group) => group.payment);
  const receiptsComplete =
    !needsReceipt || shopsWithDetails.every((group) => Boolean(receipts[group.key]?.url));

  // GCash is the default, but a basket from a shop that only takes cash has to
  // fall back rather than leave an impossible choice selected.
  const gcashAvailable = methodIsAvailable('gcash');
  const bankAvailable = methodIsAvailable('bank');

  useEffect(() => {
    setFormData((previous) => {
      if (previous.paymentMethod === 'gcash' && !gcashAvailable) {
        return { ...previous, paymentMethod: bankAvailable ? 'bank' : 'cod' };
      }
      if (previous.paymentMethod === 'bank' && !bankAvailable) {
        return { ...previous, paymentMethod: gcashAvailable ? 'gcash' : 'cod' };
      }
      return previous;
    });
  }, [gcashAvailable, bankAvailable]);

  const shell = (children) =>
    isPage ? (
      // Checkout as a page of its own: no overlay, and the browser window does
      // the scrolling.
      <div ref={topRef} className="mx-auto w-full max-w-2xl rounded-2xl bg-white shadow-sm">
        {children}
      </div>
    ) : (
      <div className="modal-backdrop fixed inset-0 bg-black bg-opacity-50 z-[60] flex items-center justify-center p-4">
        <div
          ref={topRef}
          role="dialog"
          aria-modal="true"
          aria-label="Checkout"
          className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        >
          {children}
        </div>
      </div>
    );

  return shell(
    <>
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
                  inputMode="numeric"
                  placeholder="09171234567"
                  maxLength={11}
                  value={formData.phone}
                  onChange={handleInputChange}
                  className="w-full min-h-[44px] px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
                <p className="mt-1 text-xs text-gray-500">{PHONE_HINT}</p>
              </div>

              <fieldset>
                <legend className="mb-2 text-sm font-semibold text-gray-900">How do you want to get your order? *</legend>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {[
                    { value: 'delivery', title: 'Delivery', detail: 'Brought to your address. Delivery fee per shop.' },
                    { value: 'pickup', title: 'Store pickup', detail: 'Collect it at the shop. No delivery fee.' },
                  ].map((option) => (
                    <label
                      key={option.value}
                      className={`flex min-h-[44px] cursor-pointer items-start gap-3 rounded-xl border-2 p-4 transition-colors ${
                        fulfillment === option.value ? 'border-blue-600 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="fulfillment"
                        value={option.value}
                        checked={fulfillment === option.value}
                        onChange={() => setFulfillment(option.value)}
                        className="mt-0.5 h-5 w-5 text-blue-600"
                      />
                      <span>
                        <span className="block font-medium text-gray-900">{option.title}</span>
                        <span className="block text-xs text-gray-500">{option.detail}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {isPickupOrder ? (
                <p className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                  Each shop prepares its part of your order for pickup. You will be notified when it is
                  <strong> ready for pickup</strong>, and the shop&apos;s address is shown on the order. Bring your
                  order number.
                </p>
              ) : (
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
              )}

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
                  <span>
                    {isPickupOrder
                      ? 'Save this phone number to my profile for faster checkout next time'
                      : 'Save this phone number and address to my profile for faster checkout next time'}
                  </span>
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
                <span className="text-gray-600">{isPickupOrder ? 'Store pickup' : 'Delivery'}</span>
                <span className={shippingFee === 0 ? 'font-semibold text-green-600' : ''}>
                  {shippingFee === 0 ? 'FREE' : `₱${shippingFee.toFixed(2)}`}
                </span>
              </div>
              {pointsDiscount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Reward points ({redemption.total.toLocaleString()} pts)</span>
                  <span className="font-semibold text-green-600">−₱{pointsDiscount.toFixed(2)}</span>
                </div>
              )}
              <div className="mt-2 flex justify-between border-t pt-2 font-bold">
                <span>Total</span>
                <span className="text-blue-600">₱{amountDue.toFixed(2)}</span>
              </div>
              {summaryItems.some((item) => item.seller_id) && shippingFee > 0 && (
                <p className="mt-2 text-xs text-gray-500">
                  Each shop delivers separately, so the fee applies once per shop.
                </p>
              )}
            </div>

            {/* CONNECT-Daet reward points: spend them on this order */}
            <div className="mb-6 rounded-xl border-2 border-yellow-200 bg-yellow-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900">CONNECT-Daet reward points</p>
                  <p className="text-sm text-gray-700">
                    You have <strong>{pointsBalance.toLocaleString()}</strong> points
                    {pointsBalance > 0 && <> (worth up to ₱{(pointsBalance * POINT_VALUE).toLocaleString()})</>}.
                  </p>
                </div>
                <label className="flex min-h-[44px] flex-shrink-0 cursor-pointer items-center gap-2 text-sm font-medium text-gray-900">
                  <input
                    type="checkbox"
                    checked={usePoints && redeemableNow > 0}
                    disabled={redeemableNow === 0}
                    onChange={(event) => setUsePoints(event.target.checked)}
                    className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                  />
                  Use points
                </label>
              </div>
              <p className="mt-2 text-xs text-gray-600">
                {redeemableNow > 0
                  ? `1 point = ₱${POINT_VALUE}. Points can pay for up to ${Math.round(MAX_REDEEM_SHARE * 100)}% of each shop's items (not the delivery fee); you can use ${redeemableNow.toLocaleString()} on this order. Points are returned if the order is cancelled.`
                  : 'Earn 10 points for every ₱100 you spend. Points are added when your order is delivered or picked up.'}
              </p>
            </div>

            {/* Payment Options. A method no shop in this basket accepts is
                simply not offered. */}
            <div className="space-y-3 mb-6">
              {onlineEnabled && (
                <label className="flex items-start p-4 border-2 rounded-xl cursor-pointer hover:bg-blue-50 transition-colors">
                  <input
                    type="radio"
                    name="paymentMethod"
                    value="xendit"
                    checked={formData.paymentMethod === 'xendit'}
                    onChange={handleInputChange}
                    className="mt-0.5 w-5 h-5 text-blue-600"
                  />
                  <span className="ml-3">
                    <span className="block font-medium">Pay online</span>
                    <span className="block text-xs text-gray-500">
                      GCash, Maya, QR Ph, card and more through Xendit. Paid instantly, no receipt to upload.
                    </span>
                  </span>
                </label>
              )}

              {gcashAvailable && (
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
              )}

              <label className="flex items-center p-4 border-2 rounded-xl cursor-pointer hover:bg-blue-50 transition-colors">
                <input
                  type="radio"
                  name="paymentMethod"
                  value="cod"
                  checked={formData.paymentMethod === 'cod'}
                  onChange={handleInputChange}
                  className="w-5 h-5 text-blue-600"
                />
                <span className="ml-3 font-medium">{isPickupOrder ? 'Cash on Pickup' : 'Cash on Delivery'}</span>
              </label>

              {bankAvailable && (
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
              )}

              {!gcashAvailable && !bankAvailable && (
                <p className="text-xs text-gray-500">
                  The shops in your basket have not set up online payments, so this order is cash on delivery.
                </p>
              )}
            </div>

            {needsReceipt && shopsWithDetails.length > 0 && (
              <div className="mb-6">
                <h3 className="mb-1 font-bold text-gray-900">
                  Pay {shopsWithDetails.length === 1 ? 'the shop' : 'each shop'} and attach your receipt
                </h3>
                <p className="mb-3 text-sm text-gray-600">
                  Send the amount shown, then upload a photo of the confirmation. The shop checks it before
                  preparing your order.
                </p>
                <ShopPaymentPanel
                  method={formData.paymentMethod}
                  groups={shopsWithDetails}
                  receipts={receipts}
                  onChange={(key, value) => setReceipts((current) => ({ ...current, [key]: value }))}
                />
              </div>
            )}

            {/* No shop details saved yet: the platform-wide account the admin
                keeps in Admin -> Settings. */}
            {needsReceipt && shopsWithDetails.length === 0 && (
              <div className="mb-6">
                <PaymentInstructions method={formData.paymentMethod} settings={shopSettings} compact />
              </div>
            )}

            <div className="mb-6 rounded-xl border border-gray-200 p-4 text-sm text-gray-700">
              <p className="font-semibold text-gray-900 mb-1">{isPickupOrder ? 'Store pickup for' : 'Deliver to'}</p>
              <p className="break-words">{formData.fullName} · {formData.phone}</p>
              <p className="break-words whitespace-pre-line">
                {isPickupOrder ? 'Collect at each shop. The pickup address is shown on your order.' : formData.address}
              </p>
              {summaryPoints > 0 && (
                <p className="mt-2 text-xs text-yellow-800">You will earn about {summaryPoints} reward points once this order is {isPickupOrder ? 'picked up' : 'delivered'}.</p>
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
                disabled={loading || !receiptsComplete}
                title={receiptsComplete ? undefined : 'Attach your payment receipt first'}
                className="flex-1 bg-blue-600 text-white py-4 rounded-full font-bold hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
              >
                {loading
                  ? 'Processing...'
                  : formData.paymentMethod === 'xendit'
                    ? 'Place Order & Pay'
                    : 'Place Order'}
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
                  Total: <span className="font-semibold">₱{chargedTotal.toFixed(2)}</span>
                  {placedRedeemed > 0 && <> (after {placedRedeemed.toLocaleString()} points)</>} · Payment:{' '}
                  <span className="font-semibold">{placedPayment === 'cod' && isPickupOrder ? 'Cash on Pickup' : PAYMENT_LABELS[placedPayment] || placedPayment}</span>
                </p>
              </div>
            )}
            {placedPayment === 'xendit' && placedCheckoutId && (
              <div className="mb-4 rounded-xl border-2 border-amber-200 bg-amber-50 p-4 text-left text-sm text-amber-900">
                <p className="font-semibold">Your order is waiting for payment.</p>
                {paymentStartError && <p className="mt-1">{paymentStartError}</p>}
                <p className="mt-1">
                  You can pay now, or later from My Orders. An order that is not paid within 24 hours is cancelled.
                </p>
                <button
                  type="button"
                  onClick={() => goToOnlinePayment(placedCheckoutId)}
                  disabled={startingPayment}
                  className="mt-3 min-h-[44px] w-full rounded-full bg-blue-600 font-bold text-white hover:bg-blue-700 disabled:bg-gray-400"
                >
                  {startingPayment ? 'Opening Xendit...' : 'Pay now'}
                </button>
              </div>
            )}
            {(placedPayment === 'gcash' || placedPayment === 'bank') && (
              <div className="mb-4">
                <PaymentInstructions
                  method={placedPayment}
                  settings={shopSettings}
                  amount={chargedTotal}
                  orderNumbers={orderNumbers}
                />
              </div>
            )}
            {awardedPoints > 0 && (
              <div className="bg-blue-50 rounded-xl p-4 mb-6">
                <p className="text-sm text-gray-600">
                  You&apos;ll earn <span className="font-bold text-blue-600">{awardedPoints} points</span> once your order
                  {isPickupOrder ? ' is picked up' : ' arrives'}. Tap <strong>Order Received</strong> in My Orders when you get it.
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
    </>
  );
}
