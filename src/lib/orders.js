import { supabase } from './supabaseClient';

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

  return {
    status: data?.status || 'cancelled',
    restoredItems: Number(data?.restored_items) || 0,
  };
};

/** Short, readable order number shown to buyers, sellers and admins. */
export const formatOrderNumber = (orderId) =>
  orderId ? `#${String(orderId).slice(0, 8).toUpperCase()}` : '';

export const PAYMENT_LABELS = {
  gcash: 'GCash',
  cod: 'Cash on Delivery',
  bank: 'Bank Transfer',
};

/** 10 reward points for every full ₱100, counted per shop order. */
export const estimateRewardPoints = (items) => {
  const totalsBySeller = new Map();

  (items || []).forEach((item) => {
    const key = item.seller_id || 'platform';
    const amount = (Number(item.price) || 0) * (Number(item.quantity) || 0);
    totalsBySeller.set(key, (totalsBySeller.get(key) || 0) + amount);
  });

  let points = 0;
  totalsBySeller.forEach((amount) => {
    points += Math.floor(amount / 100) * 10;
  });

  return points;
};
