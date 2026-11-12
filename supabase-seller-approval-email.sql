-- ============================================================================
-- CONNECT-Daet.ph - email a seller when their shop is approved
--
-- Run this in Supabase -> SQL Editor AFTER supabase-notifications-payments.sql.
--
-- The site has no server of its own, so the email is sent from the database
-- using pg_net (an HTTP client that ships with Supabase) and Brevo's
-- transactional email API - the same Brevo account already sending the sign-up
-- codes.
--
-- BEFORE IT WILL SEND, do these two things once:
--
--   1. Supabase -> Database -> Extensions -> enable "pg_net".
--
--   2. Get an API key (not the SMTP key) from Brevo:
--        Brevo -> SMTP & API -> API keys -> Generate a new API key
--      then paste it, and the address your Brevo account sends from, here and
--      run these three lines:
--
--        select public.set_app_secret('brevo_api_key', 'xkeysib-PASTE-YOURS');
--        select public.set_app_secret('mail_from_email', 'connectdaet777@gmail.com');
--        select public.set_app_secret('mail_from_name', 'CONNECT-Daet.ph');
--
-- Until those are set, approving a shop simply does not send an email; the
-- in-app notification still appears, and nothing fails.
-- ============================================================================

begin;

-- The admin can record why an application was declined; the column is created
-- here in case an older database does not have it yet.
alter table shop_sellers add column if not exists rejection_reason text;

-- ----------------------------------------------------------------------------
-- 1. A private place for keys
-- ----------------------------------------------------------------------------
-- No policies are created, and RLS is on, so nothing reached through the
-- website can read this table. Only the SQL editor and SECURITY DEFINER
-- functions below can.
create table if not exists app_secrets (
  name text primary key,
  value text not null,
  updated_at timestamptz default now()
);

alter table app_secrets enable row level security;
revoke all on table app_secrets from anon, authenticated;

create or replace function public.set_app_secret(p_name text, p_value text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into app_secrets (name, value, updated_at)
  values (p_name, p_value, now())
  on conflict (name) do update set value = excluded.value, updated_at = now();
$$;

revoke all on function public.set_app_secret(text, text) from public, anon, authenticated;

create or replace function public.app_secret(p_name text)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select value from app_secrets where name = p_name;
$$;

revoke all on function public.app_secret(text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Send one email through Brevo
-- ----------------------------------------------------------------------------
-- Returns quietly when pg_net is off or no key has been set, so a missing
-- setup can never block an admin from approving a shop.
create or replace function public.send_app_email(
  p_to_email text,
  p_to_name text,
  p_subject text,
  p_html text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := public.app_secret('brevo_api_key');
  v_from_email text := coalesce(public.app_secret('mail_from_email'), '');
  v_from_name text := coalesce(public.app_secret('mail_from_name'), 'CONNECT-Daet.ph');
begin
  if coalesce(v_key, '') = '' or coalesce(v_from_email, '') = '' then
    return; -- not configured yet
  end if;

  if coalesce(btrim(p_to_email), '') = '' then
    return;
  end if;

  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'pg_net is not enabled, so no email was sent to %', p_to_email;
    return;
  end if;

  perform net.http_post(
    url := 'https://api.brevo.com/v3/smtp/email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'accept', 'application/json',
      'api-key', v_key
    ),
    body := jsonb_build_object(
      'sender', jsonb_build_object('email', v_from_email, 'name', v_from_name),
      'to', jsonb_build_array(
        jsonb_build_object('email', p_to_email, 'name', coalesce(nullif(btrim(p_to_name), ''), p_to_email))
      ),
      'subject', p_subject,
      'htmlContent', p_html
    )
  );
exception
  when others then
    -- An email that cannot be sent is never a reason to undo an approval.
    raise notice 'Could not send the email to %: %', p_to_email, sqlerrm;
end;
$$;

revoke all on function public.send_app_email(text, text, text, text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Approval now emails the shop owner as well as notifying them in the app
-- ----------------------------------------------------------------------------
create or replace function public.notify_shop_decision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text;
  v_site text := coalesce(public.app_secret('site_url'), 'https://capstone2-tawny-iota.vercel.app');
begin
  if coalesce(new.is_approved, false) and not coalesce(old.is_approved, false) then
    perform public.push_notification(
      new.user_id, 'seller', 'shop',
      'Your shop is approved',
      new.business_name || ' is live. You can start adding products.',
      '/shop/seller/dashboard?tab=products'
    );

    -- The address the owner verified at sign-up, falling back to the shop's
    -- contact address.
    select coalesce(u.email, new.contact_email)
    into v_email
    from auth.users u
    where u.id = new.user_id;

    perform public.send_app_email(
      coalesce(v_email, new.contact_email),
      new.business_name,
      'Your shop on CONNECT-Daet.ph is approved',
      '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#111827">'
      || '<h2 style="color:#1d4ed8;margin:0 0 12px">Your shop is approved</h2>'
      || '<p>Good news — <strong>' || new.business_name || '</strong> has been approved by the '
      || 'CONNECT-Daet.ph admin and is now open to shoppers.</p>'
      || '<p>You can sign in to your seller dashboard to add products, set your GCash and bank details, '
      || 'and start taking orders.</p>'
      || '<p style="margin:24px 0"><a href="' || v_site || '/shop/seller" '
      || 'style="background:#2563eb;color:#ffffff;padding:12px 24px;border-radius:8px;'
      || 'text-decoration:none;font-weight:bold">Open my seller dashboard</a></p>'
      || '<p style="color:#6b7280;font-size:12px">Supporting local artisans of Daet, Camarines Norte.</p>'
      || '</div>'
    );

  elsif coalesce(new.is_rejected, false) and not coalesce(old.is_rejected, false) then
    perform public.push_notification(
      new.user_id, 'seller', 'shop',
      'Your shop application was declined',
      'Please contact CONNECT-Daet support if you think this is a mistake.',
      '/shop/seller'
    );

    select coalesce(u.email, new.contact_email)
    into v_email
    from auth.users u
    where u.id = new.user_id;

    perform public.send_app_email(
      coalesce(v_email, new.contact_email),
      new.business_name,
      'About your shop application on CONNECT-Daet.ph',
      '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#111827">'
      || '<h2 style="margin:0 0 12px">Your shop application</h2>'
      || '<p>Thank you for applying to sell on CONNECT-Daet.ph. After review, '
      || '<strong>' || new.business_name || '</strong> was not approved at this time.</p>'
      || coalesce('<p><strong>Reason:</strong> ' || nullif(btrim(new.rejection_reason), '') || '</p>', '')
      || '<p>If you think this is a mistake, or you would like to re-apply, please reply to this email.</p>'
      || '</div>'
    );

  elsif coalesce(old.is_active, true) and not coalesce(new.is_active, true) then
    perform public.push_notification(
      new.user_id, 'seller', 'shop',
      'Your shop was deactivated',
      'Customers can no longer see your products. Contact support for help.',
      '/shop/seller'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists notify_shop_decision on shop_sellers;
create trigger notify_shop_decision
  after update on shop_sellers
  for each row execute function public.notify_shop_decision();

commit;

-- ============================================================================
-- Test it (optional), with your own address:
--   select public.send_app_email('you@example.com', 'You', 'Test', '<p>Hello</p>');
-- Then check Brevo -> Statistics -> Email for the send.
-- ============================================================================
