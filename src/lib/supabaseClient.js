import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Validate environment variables
if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables. Please check your .env.local file.');
  console.error('Required: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

export const AUTH_STORAGE_KEY = 'connect-daet-auth';
const ADMIN_MODE_KEY = 'connect-daet-admin-session';

const hasWindow = () => typeof window !== 'undefined';

/**
 * True while this browser tab holds an admin session.
 * sessionStorage is emptied when the tab is closed, so the flag - and with it
 * the admin's stored login - never survives into the next visit.
 */
const isAdminSession = () => {
  if (!hasWindow()) return false;
  try {
    return window.sessionStorage.getItem(ADMIN_MODE_KEY) === 'true';
  } catch (error) {
    return false;
  }
};

/**
 * Customers and sellers stay signed in between visits, which is what a shop
 * should do. An admin session is different: it is kept in sessionStorage, so
 * closing the tab ends it and opening the site again starts signed out. That
 * stops the admin panel from being left open on a shared computer, and stops
 * the storefront from greeting a visitor with "Admin Panel".
 *
 * One consequence worth knowing: an admin session belongs to the tab it was
 * created in. Opening the admin panel in a second tab asks for the password
 * again.
 */
const hybridStorage = {
  getItem: (key) => {
    if (!hasWindow()) return null;
    try {
      return isAdminSession() ? window.sessionStorage.getItem(key) : window.localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  },
  setItem: (key, value) => {
    if (!hasWindow()) return;
    try {
      if (isAdminSession()) {
        window.sessionStorage.setItem(key, value);
        window.localStorage.removeItem(key);
      } else {
        window.localStorage.setItem(key, value);
      }
    } catch (error) {
      console.warn('Could not save the session:', error?.message || error);
    }
  },
  removeItem: (key) => {
    if (!hasWindow()) return;
    try {
      window.sessionStorage.removeItem(key);
      window.localStorage.removeItem(key);
    } catch (error) {
      console.warn('Could not clear the session:', error?.message || error);
    }
  },
};

export const supabase = createClient(
  supabaseUrl || '',
  supabaseAnonKey || '',
  {
    auth: {
      storageKey: AUTH_STORAGE_KEY,
      storage: hasWindow() ? hybridStorage : undefined,
      persistSession: true,
      autoRefreshToken: true,
      // The password-reset and email-confirmation links carry the session in
      // the URL and must be picked up when the page opens.
      detectSessionInUrl: true,
    },
  }
);

/**
 * Move the signed-in admin's session out of localStorage and into this tab.
 * Called as soon as an account is known to be an admin.
 */
export const startAdminSession = () => {
  if (!hasWindow() || isAdminSession()) return;

  try {
    window.sessionStorage.setItem(ADMIN_MODE_KEY, 'true');

    const token = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (token) {
      window.sessionStorage.setItem(AUTH_STORAGE_KEY, token);
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  } catch (error) {
    console.warn('Could not start the admin session:', error?.message || error);
  }
};

/**
 * Remove any session this browser still has stored, including the key used by
 * older builds of the site. Called when signing out so a stale token can never
 * bring a closed session back on the next reload.
 */
export const clearStoredSession = () => {
  if (!hasWindow()) return;

  try {
    window.sessionStorage.removeItem(ADMIN_MODE_KEY);

    const stale = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key && (key === AUTH_STORAGE_KEY || key.startsWith('connect-daet-auth-') || key.startsWith('sb-'))) {
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
