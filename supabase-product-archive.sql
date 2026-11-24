-- ============================================================================
-- Deleting a product that past orders point to archives it instead of
-- erasing the row: past orders and the shop's sales history stay complete,
-- and the product leaves the storefront (available = false) and the seller's
-- product list (archived_at is set). Run once in the Supabase SQL editor.
-- ============================================================================
alter table public.shop_products
  add column if not exists archived_at timestamptz;

-- An archived product can never be listed again.
create or replace function public.keep_archived_products_hidden()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.archived_at is not null then
    new.available := false;
  end if;
  return new;
end;
$$;

drop trigger if exists keep_archived_products_hidden on public.shop_products;
create trigger keep_archived_products_hidden
  before insert or update on public.shop_products
  for each row execute function public.keep_archived_products_hidden();
