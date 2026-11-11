-- ============================================================================
-- CONNECT-Daet - "Order Received" for buyers
-- ============================================================================
-- Run this ONCE in the Supabase SQL Editor, after supabase-checkout-security.sql.
-- It is safe to re-run.
--
-- Buyers have no write access to shop_orders (checkout and status changes all
-- go through SECURITY DEFINER functions). This adds the one status change a
-- buyer is allowed to make: confirming that a shipped parcel arrived, which is
-- what the "Order Received" button calls. It is also what unlocks reviewing,
-- since only delivered items can be reviewed.
-- ============================================================================

begin;

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

  -- Only a parcel the shop has actually sent can be confirmed as received.
  if v_order.status <> 'shipped' then
    raise exception 'This order has not been shipped yet, so it cannot be marked as received.'
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

commit;

-- ============================================================================
-- Check after running (optional):
--   select proname from pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname = 'confirm_order_received';
-- ============================================================================
