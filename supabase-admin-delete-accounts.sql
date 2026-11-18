-- ============================================================================
-- CONNECT-Daet.ph - deleting a customer or seller from the admin panel
--
-- Run in Supabase -> SQL Editor AFTER supabase-seller-only-listings.sql.
--
-- Deleting an account removes it from Supabase completely: the login
-- (auth.users, with its identities and sessions), and through ON DELETE
-- CASCADE the profile, reward history, shop, cart, chats and notifications.
-- Past orders are kept (without the account) so sales reports stay correct.
--
-- New here: orders that were still unfinished (pending, confirmed or
-- processing) are cancelled first, so nothing is left to fulfil for an
-- account that no longer exists. Cancelling puts the stock back and returns
-- any reward points the customer spent on them. Shipped orders are left as
-- they are: the goods are already on the way.
-- ============================================================================

begin;

create or replace function public.admin_delete_account(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order uuid;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can delete accounts.' using errcode = '42501';
  end if;

  if p_user_id is null or p_user_id = auth.uid() then
    raise exception 'You cannot delete your own account here.' using errcode = '22023';
  end if;

  if exists (select 1 from profiles where id = p_user_id and user_type = 'admin') then
    raise exception 'Admin accounts cannot be deleted from this page.' using errcode = '42501';
  end if;

  -- Unfinished orders the customer placed, and (if they also run a shop)
  -- unfinished orders placed with that shop.
  for v_order in
    select o.id
    from shop_orders o
    where o.status in ('pending', 'confirmed', 'processing')
      and (o.user_id = p_user_id
           or o.seller_id in (select id from shop_sellers where user_id = p_user_id))
    order by o.id
    for update
  loop
    perform public._cancel_order_internal(v_order);
  end loop;

  delete from shop_products p
  where p.seller_id in (select id from shop_sellers where user_id = p_user_id)
    and not exists (select 1 from shop_order_items i where i.product_id = p.id);

  update shop_products
  set available = false, updated_at = now()
  where seller_id in (select id from shop_sellers where user_id = p_user_id);

  -- The Supabase login itself. Everything tied to it cascades.
  delete from auth.users where id = p_user_id;
end;
$$;

create or replace function public.admin_delete_seller(p_seller_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
  v_order uuid;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can delete shops.' using errcode = '42501';
  end if;

  select user_id into v_user from shop_sellers where id = p_seller_id;
  if not found then
    raise exception 'Shop not found.' using errcode = 'P0002';
  end if;

  -- Orders this shop had not finished: nobody is left to send them.
  for v_order in
    select o.id
    from shop_orders o
    where o.seller_id = p_seller_id
      and o.status in ('pending', 'confirmed', 'processing')
    order by o.id
    for update
  loop
    perform public._cancel_order_internal(v_order);
  end loop;

  delete from shop_products p
  where p.seller_id = p_seller_id
    and not exists (select 1 from shop_order_items i where i.product_id = p.id);

  update shop_products
  set available = false, updated_at = now()
  where seller_id = p_seller_id;

  if v_user is not null
     and v_user is distinct from auth.uid()
     and not exists (select 1 from profiles where id = v_user and user_type = 'admin') then
    -- The seller's Supabase login; the shop, profile and the rest cascade.
    delete from auth.users where id = v_user;
  else
    delete from shop_sellers where id = p_seller_id;
  end if;
end;
$$;

revoke all on function public.admin_delete_account(uuid) from public, anon;
grant execute on function public.admin_delete_account(uuid) to authenticated;
revoke all on function public.admin_delete_seller(uuid) from public, anon;
grant execute on function public.admin_delete_seller(uuid) to authenticated;

commit;
