-- GCash / bank transfer orders are never marked "paid" in the database: the
-- customer sends the money and attaches a receipt. Cancelling such an order
-- used to say nothing about the money already sent. Now the shop is told to
-- refund the customer, the same way the admin is told for online payments.
-- Run this once in the Supabase SQL editor. Safe to run again.

create or replace function public._cancel_order_internal(p_order_id uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_order record;
  v_restored integer;
begin
  select id, user_id, seller_id, voucher_code, payment_status, payment_method, payment_proof_url,
         total_amount, status
  into v_order from shop_orders where id = p_order_id;

  perform 1 from shop_products p
  where p.id in (select product_id from shop_order_items where order_id = p_order_id)
  order by p.id for update;

  update shop_products p
  set stock = coalesce(p.stock, 0) + i.quantity, updated_at = now()
  from (
    select product_id, sum(quantity)::integer as quantity
    from shop_order_items where order_id = p_order_id and product_id is not null
    group by product_id
  ) i
  where p.id = i.product_id;
  get diagnostics v_restored = row_count;

  perform public._revoke_order_points(v_order.user_id, p_order_id);

  if v_order.voucher_code is not null and v_order.status is distinct from 'cancelled' then
    perform set_config('app.voucher_redemption', 'true', true);
    update shop_vouchers set used_count = greatest(used_count - 1, 0)
    where seller_id = v_order.seller_id and code = v_order.voucher_code;
    perform set_config('app.voucher_redemption', 'false', true);
  end if;

  update shop_orders set status = 'cancelled', updated_at = now() where id = p_order_id;

  if v_order.payment_status = 'paid' then
    perform public.push_admin_notification(
      'refund', 'Refund needed',
      'Order ' || upper(left(p_order_id::text, 8)) || ' was cancelled after it was paid (PHP ' ||
        to_char(v_order.total_amount, 'FM999,999,990.00') || '). Refund the customer, then mark it refunded.',
      '/shop/admin?tab=orders&order=' || p_order_id);
  elsif v_order.payment_method in ('gcash', 'bank')
        and v_order.payment_proof_url is not null
        and v_order.status is distinct from 'cancelled' then
    -- The customer had already sent the money to the shop.
    perform public.push_notification(
      (select s.user_id from shop_sellers s where s.id = v_order.seller_id),
      'seller', 'order', 'Refund needed',
      'Order ' || upper(left(p_order_id::text, 8)) || ' was cancelled, but the customer had already sent PHP ' ||
        to_char(v_order.total_amount, 'FM999,999,990.00') || ' (receipt attached). Please refund them.',
      '/shop/seller/dashboard?tab=orders&order=' || p_order_id);
  end if;

  return v_restored;
end;
$function$;
