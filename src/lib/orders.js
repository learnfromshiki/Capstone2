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
