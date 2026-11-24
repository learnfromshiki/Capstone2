-- ============================================================================
-- 2026-11-24 audit fixes. Run AFTER supabase-refund-notices-and-delivery.sql.
-- Safe to re-run.
--
-- 1. Automatic Order Received: a shipped (or ready-for-pickup) order that the
--    customer has not confirmed within 7 days is marked delivered, so the
--    shop's earnings are released and the customer's points are granted.
--    Runs hourly through pg_cron when it can be enabled, and also whenever a
--    dashboard loads (auto_confirm_shipped_orders(), which only ever
--    completes orders that are already due).
-- 2. New orders can only be paid online (Xendit) or in cash; manual GCash and
--    bank transfer were removed from the store.
-- ============================================================================

-- 1. ------------------------------------------------------------------------
-- Days a customer has to tap Order Received (keep in sync with
-- AUTO_CONFIRM_DAYS in src/lib/orders.js).
alter table public.shop_orders add column if not exists shipped_at timestamptz;

-- Orders already shipped get the full 7 days from now.
update public.shop_orders
set shipped_at = now()
where status = 'shipped' and shipped_at is null;

create or replace function public.stamp_shipped_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'shipped' and old.status is distinct from 'shipped' then
    new.shipped_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists stamp_shipped_at on public.shop_orders;
create trigger stamp_shipped_at
  before update of status on public.shop_orders
  for each row execute function public.stamp_shipped_at();

create or replace function public.auto_confirm_shipped_orders()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  -- Lets guard_order_status_rules() allow this one system update.
  perform set_config('app.auto_confirm', 'true', true);

  update shop_orders
  set status = 'delivered',
      updated_at = now()
  where status = 'shipped'
    and shipped_at is not null
    and shipped_at < now() - interval '7 days';
  get diagnostics v_count = row_count;

  perform set_config('app.auto_confirm', 'false', true);
  return v_count;
end;
$$;

revoke all on function public.auto_confirm_shipped_orders() from public, anon;
grant execute on function public.auto_confirm_shipped_orders() to authenticated;

-- Hourly job, when pg_cron can be enabled on this project. If it cannot, the
-- dashboards still run the catch-up whenever they load.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'auto-confirm-shipped-orders';
  perform cron.schedule('auto-confirm-shipped-orders', '15 * * * *', 'select public.auto_confirm_shipped_orders()');
exception when others then
  raise notice 'pg_cron is not available (%); dashboards will run the catch-up instead.', sqlerrm;
end;
$$;

-- 2. ------------------------------------------------------------------------
create or replace function public.only_online_or_cash_orders()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.payment_method in ('gcash', 'bank') then
    raise exception 'Please pay online or with cash. GCash and bank transfer are paid online through Xendit now.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists only_online_or_cash_orders on public.shop_orders;
create trigger only_online_or_cash_orders
  before insert on public.shop_orders
  for each row execute function public.only_online_or_cash_orders();
