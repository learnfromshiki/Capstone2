import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * The admin panel is a separate portal, so it keeps its own auth session.
 * Sharing the default storage key meant signing in as admin also replaced the
 * buyer/seller session in the storefront on the same browser.
 */
export const supabaseAdmin = createClient(
  supabaseUrl || '',
  supabaseAnonKey || '',
  {
    auth: {
      storageKey: 'connect-daet-admin-auth',
      // Tab-scoped like the storefront client: a refresh stays signed in, but a
      // new visit starts at the admin login instead of restoring an old session.
      storage:
        typeof window !== 'undefined' ? window.sessionStorage : undefined,
      persistSession: true,
      autoRefreshToken: true,
    },
  }
);
