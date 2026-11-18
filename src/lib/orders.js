import { supabase } from './supabaseClient';
import { requestBadgeRefresh } from './badges';
import { releaseOnlinePayment } from './xendit';

export const ORDER_STATUSES = [
  'pending',
  'confirmed',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
];

export const STATUS_LABELS = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  processing: 'Processing',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

/**
 * Cancelled and delivered are terminal states. Everything else can move
 * forward, or be cancelled. Keeping this in one place stops the admin and
 * seller dashboards from disagreeing about what a valid transition is.
 */
export const getAllowedStatuses = (status) => {
  switch (status) {
    case 'pending':
      return ['pending', 'confirmed', 'processing', 'cancelled'];
    case 'confirmed':
      return ['confirmed', 'processing', 'shipped', 'cancelled'];
    case 'processing':
      return ['processing', 'shipped', 'cancelled'];
    case 'shipped':
      return ['shipped', 'delivered'];
    case 'delivered':
      return ['delivered'];
    case 'cancelled':
      return ['cancelled'];
    default:
      return ORDER_STATUSES;
  }
};

/**
 * The statuses this particular order can be given. An online (Xendit) order
 * that has not been paid can only stay pending or be cancelled: nothing is
 * prepared before the money arrives (the database enforces the same rule).
 */
export const allowedStatusesFor = (order) => {
  const allowed = getAllowedStatuses(order?.status);
  if (order?.payment_method === 'xendit' && order?.payment_status !== 'paid') {
    return allowed.filter((status) => status === order.status || status === 'cancelled');
  }
  return allowed;
};

export const canTransition = (from, to) =>
  Boolean(from) && Boolean(to) && from !== to && getAllowedStatuses(from).includes(to);

/**
 * Put stock back after a cancelled order. The stock column is updated with an
 * optimistic compare-and-set so two simultaneous cancellations cannot restore
 * the same units twice.
 */
const restoreStock = async (items) => {
  const restored = [];

  for (const item of items) {
    const quantity = Number(item.quantity);
    if (!item.product_id || !Number.isInteger(quantity) || quantity <= 0) continue;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { data: product, error: readError } = await supabase
        .from('shop_products')
        .select('stock')
        .eq('id', item.product_id)
        .maybeSingle();

      if (readError) throw readError;

      // The product may have been deleted after the order was placed.
      if (!product) break;

      const currentStock = Number(product.stock) || 0;
      const { data: updated, error: updateError } = await supabase
        .from('shop_products')
        .update({ stock: currentStock + quantity })
        .eq('id', item.product_id)
        .eq('stock', currentStock)
        .select('id');

      if (updateError) throw updateError;

      if (updated && updated.length > 0) {
        restored.push({ productId: item.product_id, quantity });
        break;
      }

      if (attempt === 2) {
        throw new Error(`Could not restore stock for ${item.product_name || 'a product'}.`);
      }
    }
  }

  return restored;
};

const undoStockRestore = async (restored) => {
  for (const entry of restored) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { data: product } = await supabase
        .from('shop_products')
        .select('stock')
        .eq('id', entry.productId)
        .maybeSingle();

      if (!product) break;

      const currentStock = Number(product.stock) || 0;
      const nextStock = Math.max(0, currentStock - entry.quantity);
      const { data: updated } = await supabase
        .from('shop_products')
        .update({ stock: nextStock })
        .eq('id', entry.productId)
        .eq('stock', currentStock)
        .select('id');

      if (updated && updated.length > 0) break;
    }
  }
};

/** True when Supabase reports that an RPC function has not been created yet. */
export const isMissingFunction = (error) =>
  error?.code === 'PGRST202' ||
  error?.code === '42883' ||
  /could not find the function|function .* does not exist/i.test(error?.message || '');

/**
 * Change an order's status and keep product stock consistent.
 *
 * Cancelling an order restores its stock exactly once. Reopening a cancelled
 * order or un-delivering a delivered order is rejected because either would
 * desynchronise stock and sold units.
 *
 * @returns {Promise<{status: string, restoredItems: number}>}
 */
export const transitionOrderStatus = async (orderId, newStatus) => {
  if (!ORDER_STATUSES.includes(newStatus)) {
    throw new Error('Unknown order status.');
  }

  // Preferred path: one database transaction that checks who may change the
  // order, validates the transition, restores stock and takes back reward
  // points on cancellation. See supabase-checkout-security.sql.
  const { data: rpcResult, error: rpcError } = await supabase.rpc('update_order_status', {
    p_order_id: orderId,
    p_status: newStatus,
  });

  if (!rpcError) {
    requestBadgeRefresh();
    // A cancelled online order must not stay payable.
    if (newStatus === 'cancelled') releaseOnlinePayment(orderId);
    return {
      status: rpcResult?.status || newStatus,
      restoredItems: Number(rpcResult?.restored_items) || 0,
    };
  }

  if (!isMissingFunction(rpcError)) {
    throw new Error(rpcError.message || 'Could not update the order.');
  }

  // Legacy path for databases that have not run supabase-checkout-security.sql.
  const { data: order, error: orderError } = await supabase
    .from('shop_orders')
    .select('id, status, shop_order_items(product_id, product_name, quantity)')
    .eq('id', orderId)
    .single();

  if (orderError) throw orderError;
  if (!order) throw new Error('Order not found.');

  const currentStatus = order.status;
  if (currentStatus === newStatus) {
    return { status: currentStatus, restoredItems: 0 };
  }

  if (!canTransition(currentStatus, newStatus)) {
    if (currentStatus === 'cancelled') {
      throw new Error('A cancelled order cannot be reopened. Create a new order instead.');
    }
    if (currentStatus === 'delivered') {
      throw new Error('A delivered order cannot be changed.');
    }
    throw new Error(`An order cannot move from ${STATUS_LABELS[currentStatus] || currentStatus} to ${STATUS_LABELS[newStatus] || newStatus}.`);
  }

  let restored = [];

  if (newStatus === 'cancelled') {
    restored = await restoreStock(order.shop_order_items || []);
  }

  // The status condition prevents two admins/sellers cancelling at once and
  // restoring the same stock twice.
  const { data: updatedOrders, error: updateError } = await supabase
    .from('shop_orders')
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', orderId)
    .eq('status', currentStatus)
    .select('id');

  if (updateError) {
    if (restored.length) await undoStockRestore(restored);
    throw updateError;
  }

  if (!updatedOrders || updatedOrders.length === 0) {
    if (restored.length) await undoStockRestore(restored);
    throw new Error('This order was updated by someone else. Refresh and try again.');
  }

  return { status: newStatus, restoredItems: restored.length };
};

/**
 * Let a buyer cancel their own order while it is still pending. Needs the
 * cancel_my_order() function from supabase-checkout-security.sql; buyers have
 * no direct write access to orders or stock.
 */
export const cancelMyOrder = async (orderId) => {
  const { data, error } = await supabase.rpc('cancel_my_order', { p_order_id: orderId });

  if (error) {
    if (isMissingFunction(error)) {
      throw new Error('Online cancellation is not available yet. Please contact the shop to cancel this order.');
    }
    throw new Error(error.message || 'Could not cancel the order.');
  }

  requestBadgeRefresh();
  releaseOnlinePayment(orderId);
  return {
    status: data?.status || 'cancelled',
    restoredItems: Number(data?.restored_items) || 0,
  };
};

/**
 * The buyer confirms the order arrived (once the shop accepted it), which also
 * grants their reward points. Needs confirm_order_received()
 * from supabase-points-on-delivery.sql; buyers cannot write to orders directly.
 */
export const confirmOrderReceived = async (orderId) => {
  const { data, error } = await supabase.rpc('confirm_order_received', { p_order_id: orderId });

  if (error) {
    if (isMissingFunction(error)) {
      throw new Error(
        'Confirming delivery is not available yet. Ask the shop admin to run supabase-buyer-confirm-order.sql in Supabase.'
      );
    }
    throw new Error(error.message || 'Could not confirm this order.');
  }

  requestBadgeRefresh();
  return { status: data?.status || 'delivered' };
};

/**
 * Does this order count as a sale in totals and reports? Cancelled orders are
 * refunds, and an online (Xendit) order that was never paid is not money
 * received. Every dashboard uses this one rule so their figures agree.
 */
/** Payment methods settled online, through Xendit. */
export const ONLINE_PAYMENT_METHODS = ['xendit'];

export const isCountedSale = (order) =>
  Boolean(order) &&
  order.status !== 'cancelled' &&
  !(ONLINE_PAYMENT_METHODS.includes(order.payment_method) && order.payment_status !== 'paid');

/** Short, readable order number shown to buyers, sellers and admins. */
export const formatOrderNumber = (orderId) =>
  orderId ? `#${String(orderId).slice(0, 8).toUpperCase()}` : '';

export const PAYMENT_LABELS = {
  xendit: 'Online payment (Xendit)',
  gcash: 'GCash',
  cod: 'Cash on Delivery',
  bank: 'Bank Transfer',
};

/** 10 reward points for every full ₱100, counted per shop order. */
export const estimateRewardPoints = (items, redeemedBySeller = {}) => {
  const totalsBySeller = new Map();

  (items || []).forEach((item) => {
    const key = item.seller_id || 'platform';
    const amount = (Number(item.price) || 0) * (Number(item.quantity) || 0);
    totalsBySeller.set(key, (totalsBySeller.get(key) || 0) + amount);
  });

  let points = 0;
  totalsBySeller.forEach((amount, key) => {
    // Points are earned on what is paid for the goods, after any points spent.
    const paid = Math.max(0, amount - (Number(redeemedBySeller[key]) || 0));
    points += Math.floor(paid / 100) * 10;
  });

  return points;
};

// ---------------------------------------------------------------------------
// Delivery or store pickup
// ---------------------------------------------------------------------------
export const FULFILLMENT_LABELS = {
  delivery: 'Delivery',
  pickup: 'Store pickup',
};

export const isPickup = (order) => order?.fulfillment_method === 'pickup';

/**
 * The status as the customer should read it. A pickup order is never
 * "shipped": it is ready for pickup, and "delivered" means picked up.
 */
export const statusLabel = (status, order) => {
  if (isPickup(order)) {
    if (status === 'shipped') return 'Ready for pickup';
    if (status === 'delivered') return 'Picked up';
  }
  return STATUS_LABELS[status] || status || 'Unknown';
};

/** "Cash on Delivery" reads as "Pay at pickup" on a pickup order. */
export const paymentLabel = (method, order) => {
  if (method === 'cod' && isPickup(order)) return 'Cash on Pickup';
  return PAYMENT_LABELS[method] || method;
};

// ---------------------------------------------------------------------------
// Reward points redemption. Must match place_order() in
// supabase-cart-pickup-redemption.sql.
// ---------------------------------------------------------------------------
/** ₱ value of one reward point. */
export const POINT_VALUE = 1;
/** Points may pay for at most this share of each shop's goods. */
export const MAX_REDEEM_SHARE = 0.5;

/**
 * How many of `points` are spent on each shop's order. Shops are taken in the
 * same order the database uses (by seller id, the platform last), and each
 * takes up to half of its goods.
 *
 * @param {Record<string, number>} subtotals  goods subtotal per seller key
 * @returns {{ bySeller: Record<string, number>, total: number, max: number }}
 */
export const allocateRedemption = (subtotals, points) => {
  const keys = Object.keys(subtotals).sort((a, b) => {
    if (a === 'platform') return 1;
    if (b === 'platform') return -1;
    // Plain code-point order, as uuids compare in Postgres.
    return a < b ? -1 : a > b ? 1 : 0;
  });

  let left = Math.max(0, Math.floor(Number(points) || 0));
  let max = 0;
  const bySeller = {};

  keys.forEach((key) => {
    const cap = Math.floor((Number(subtotals[key]) || 0) * MAX_REDEEM_SHARE);
    max += cap;
    const used = Math.min(left, cap);
    bySeller[key] = used;
    left -= used;
  });

  const total = Object.values(bySeller).reduce((sum, value) => sum + value, 0);
  return { bySeller, total, max };
};
