import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Validate environment variables
if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables. Please check your .env.local file.');
  console.error('Required: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

/**
 * One shared session for the whole browser.
 *
 * This used to keep a separate session per tab (sessionStorage plus a random
 * per-tab key) so that several test accounts could be signed in side by side.
 * For a real shop that behaves like a bug:
 *   - opening a product in a new tab showed a signed-out header and an empty
 *     cart, and "Add to cart" asked the customer to sign in again;
 *   - coming back to the site later always started signed out;
 *   - signing out in one tab left the other tabs still signed in, so the next
 *     click there failed with an expired session.
 *
 * localStorage with one key is the normal setup: sign in once, stay signed in
 * on every tab, and a single sign-out ends the session everywhere (Supabase
 * broadcasts it between tabs).
 *
 * To test a customer and a seller at the same time, use one normal window and
 * one private/incognito window - they do not share localStorage.
 */
const authStorage = typeof window !== 'undefined' ? window.localStorage : undefined;

export const supabase = createClient(
  supabaseUrl || '',
  supabaseAnonKey || '',
  {
    auth: {
      storageKey: 'connect-daet-auth',
      storage: authStorage,
      persistSession: true,
      autoRefreshToken: true,
      // The password-reset and email-confirmation links carry the session in
      // the URL and must be picked up when the page opens.
      detectSessionInUrl: true,
    },
  }
);

/**
 * Remove any session this browser still has stored, including the key used by
 * older builds of the site. Called when signing out so a stale token can never
 * bring a closed session back on the next reload.
 */
export const clearStoredSession = () => {
  if (typeof window === 'undefined') return;

  try {
    const stale = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key && (key === 'connect-daet-auth' || key.startsWith('connect-daet-auth-') || key.startsWith('sb-'))) {
        stale.push(key);
      }
    }
    stale.forEach((key) => window.localStorage.removeItem(key));

    const staleSession = [];
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index);
      if (key && (key.startsWith('connect-daet-auth') || key === 'connect-daet-tab-id')) {
        staleSession.push(key);
      }
    }
    staleSession.forEach((key) => window.sessionStorage.removeItem(key));
  } catch (error) {
    console.warn('Could not clear the stored session:', error?.message || error);
  }
};
