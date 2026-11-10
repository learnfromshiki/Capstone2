import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Validate environment variables
if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables. Please check your .env.local file.');
  console.error('Required: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

// Keep the session for the current tab only. A refresh stays signed in, but a
// new visit or tab starts signed out instead of restoring an old login forever.
const authStorage =
  typeof window !== 'undefined' ? window.sessionStorage : undefined;

// Supabase names its cross-tab BroadcastChannel after the auth storage key, so
// a shared key lets one tab's login replace the user in every other tab. Each
// tab keeps its own id (sessionStorage survives reloads) to keep logins apart.
const tabAuthStorageKey = (() => {
  const fallback = 'connect-daet-auth';
  if (typeof window === 'undefined') return fallback;

  try {
    const existingId = window.sessionStorage.getItem('connect-daet-tab-id');
    if (existingId) return `connect-daet-auth-${existingId}`;

    const id =
      typeof window.crypto?.randomUUID === 'function'
        ? window.crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

    window.sessionStorage.setItem('connect-daet-tab-id', id);
    return `connect-daet-auth-${id}`;
  } catch (error) {
    console.error('Could not prepare tab auth storage:', error);
    return fallback;
  }
})();

export const supabase = createClient(
  supabaseUrl || '', 
  supabaseAnonKey || '',
  {
    auth: {
      storageKey: tabAuthStorageKey,
      storage: authStorage,
      persistSession: true,
      autoRefreshToken: true,
    }
  }
);
