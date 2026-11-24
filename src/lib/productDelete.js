import { supabase } from './supabaseClient';

/**
 * Delete a product, the same way for a shop and for the admin.
 *
 * - In an order that is still in progress (not delivered or cancelled): not
 *   deleted, since the shop still has to fulfil it.
 * - Only in finished orders: archived, not erased. Past orders and the shop's
 *   sales history find the shop's orders through the product, so the row
 *   stays (hidden from the store and from the product lists); see
 *   supabase-product-archive.sql.
 * - Never ordered: deleted.
 *
 * @param {string} productId
 * @param {{ sellerId?: string }} [options] a shop only touches its own products
 * @returns {Promise<'deleted'|'archived'|'in_progress'|'blocked'>}
 *   'blocked' means the database refused the change (row level security).
 */
export const deleteOrArchiveProduct = async (productId, { sellerId } = {}) => {
  const scoped = (query) => (sellerId ? query.eq('seller_id', sellerId) : query);

  const { data: openItems, error: openError } = await supabase
    .from('shop_order_items')
    .select('id, shop_orders!inner(status)')
    .eq('product_id', productId)
    .not('shop_orders.status', 'in', '(delivered,cancelled)')
    .limit(1);
  if (openError) throw openError;
  if (openItems && openItems.length > 0) return 'in_progress';

  const { count: pastOrders, error: pastError } = await supabase
    .from('shop_order_items')
    .select('id', { count: 'exact', head: true })
    .eq('product_id', productId);
  if (pastError) throw pastError;

  if (pastOrders > 0) {
    let { data, error } = await scoped(
      supabase
        .from('shop_products')
        .update({ available: false, archived_at: new Date().toISOString() })
        .eq('id', productId)
    ).select('id');
    if (error && /archived_at/i.test(error.message || '')) {
      // supabase-product-archive.sql not run yet: at least hide it.
      ({ data, error } = await scoped(
        supabase.from('shop_products').update({ available: false }).eq('id', productId)
      ).select('id'));
    }
    if (error) throw error;
    return data && data.length > 0 ? 'archived' : 'blocked';
  }

  const { data, error } = await scoped(supabase.from('shop_products').delete().eq('id', productId)).select('id');
  if (error) throw error;
  return data && data.length > 0 ? 'deleted' : 'blocked';
};

/** Products a seller deleted that are kept for past orders. */
export const isArchived = (product) => Boolean(product?.archived_at);

export const IN_PROGRESS_MESSAGE =
  'This product is in an order that is still in progress. Finish or cancel that order first, or deactivate the product to hide it from the shop.';
