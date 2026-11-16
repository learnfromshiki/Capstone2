-- PayMongo online payments (GCash, Maya, cards, GrabPay, QR Ph).
--
-- Run once in the Supabase SQL editor. Safe to run again.
--
-- How it fits together:
--   1. place_order() creates the orders with payment_method = 'paymongo' and
--      payment_status = 'unpaid'.
--   2. /api/paymongo/checkout opens a PayMongo Checkout Session for the whole
--      checkout (every shop's order in it) and stores the session id.
--   3. PayMongo calls /api/paymongo/webhook when the customer pays, and the
--      success page double-checks the session. Either one marks the orders
--      paid. Both run on the server with the service role key; customers and
--      sellers can never set these columns themselves.

-- 1. New columns -------------------------------------------------------------
alter table public.shop_orders add column if not exists payment_status text;
alter table public.shop_orders add column if not exists paymongo_session_id text;
alter table public.shop_orders add column if not exists paid_at timestamptz;

alter table public.shop_orders drop constraint if exists shop_orders_payment_status_check;
alter table public.shop_orders add constraint shop_orders_payment_status_check
  check (payment_status is null or payment_status in ('unpaid', 'paid', 'failed', 'refunded'));

create index if not exists shop_orders_checkout_id_idx on public.shop_orders (checkout_id);
create index if not exists shop_orders_paymongo_session_idx on public.shop_orders (paymongo_session_id);

-- 2. Allow the new payment method -------------------------------------------
alter table public.shop_orders drop constraint if exists shop_orders_payment_method_check;
alter table public.shop_orders add constraint shop_orders_payment_method_check
  check (payment_method in ('gcash', 'cod', 'bank', 'paymongo'));

-- New PayMongo orders start unpaid.
create or replace function public.set_initial_payment_status()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.payment_method = 'paymongo' then
    new.payment_status := 'unpaid';
    new.paid_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists set_initial_payment_status on public.shop_orders;
create trigger set_initial_payment_status
  before insert on public.shop_orders
  for each row execute function public.set_initial_payment_status();

-- place_order(): accept 'paymongo'. Patched in place so the rest of the
-- function stays exactly as it is.
do $$
declare
  v_def text := pg_get_functiondef('public.place_order(jsonb, text, text, text, text, text, text, text, text)'::regprocedure);
begin
  if position('''paymongo''' in v_def) = 0 then
    v_def := replace(v_def, 'v_payment not in (''gcash'', ''cod'', ''bank'')',
                            'v_payment not in (''gcash'', ''cod'', ''bank'', ''paymongo'')');
    execute v_def;
  end if;
end $$;

-- 3. Customers and sellers cannot change the payment columns ---------------
do $$
declare
  v_def text := pg_get_functiondef('public.protect_order_customer_fields()'::regprocedure);
begin
  if position('payment_status' in v_def) = 0 then
    v_def := replace(v_def, 'new.notes := old.notes;',
      'new.notes := old.notes;' || chr(10) ||
      '  new.payment_status := old.payment_status;' || chr(10) ||
      '  new.paymongo_session_id := old.paymongo_session_id;' || chr(10) ||
      '  new.paid_at := old.paid_at;');
    execute v_def;
  end if;
end $$;

-- 4. A paid order cannot be cancelled by the buyer online -------------------
-- The money has already moved, so the shop or admin handles the refund.
do $$
declare
  v_def text := pg_get_functiondef('public.cancel_my_order(uuid)'::regprocedure);
begin
  if position('payment_status' in v_def) = 0 then
    v_def := replace(v_def, 'select id, status, user_id into v_order',
                            'select id, status, user_id, payment_status into v_order');
    v_def := replace(v_def, '  v_restored := public._cancel_order_internal(p_order_id);',
      '  if v_order.payment_status = ''paid'' then' || chr(10) ||
      '    raise exception ''This order has already been paid online. Please contact the shop to cancel it and arrange a refund.''' || chr(10) ||
      '      using errcode = ''P0001'';' || chr(10) ||
      '  end if;' || chr(10) || chr(10) ||
      '  v_restored := public._cancel_order_internal(p_order_id);');
    execute v_def;
  end if;
end $$;
