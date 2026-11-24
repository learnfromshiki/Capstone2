-- ============================================================================
-- "Order Received" only after the shop has shipped the order (or made a pickup
-- order ready). A confirmed or processing order has not left the shop yet, so
-- the customer cannot mark it as received. (2026-11-24; included in
-- supabase-run-all-2026-11-24.sql.)
-- ============================================================================
create or replace function public.confirm_order_received(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_order record;
begin
  if v_user is null then
    raise exception 'Please sign in again.' using errcode = '28000';
  end if;

  select id, status, user_id into v_order
  from shop_orders
  where id = p_order_id
  for update;

  if not found or v_order.user_id is distinct from v_user then
    raise exception 'Order not found.' using errcode = 'P0002';
  end if;

  if v_order.status = 'delivered' then
    return jsonb_build_object('status', 'delivered');
  end if;

  if v_order.status <> 'shipped' then
    raise exception 'The shop has not shipped this order yet, so it cannot be marked as received.'
      using errcode = 'P0001';
  end if;

  update shop_orders
  set status = 'delivered',
      updated_at = now()
  where id = p_order_id;

  return jsonb_build_object('status', 'delivered');
end;
$$;

revoke all on function public.confirm_order_received(uuid) from public, anon;
grant execute on function public.confirm_order_received(uuid) to authenticated;
