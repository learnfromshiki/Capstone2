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

export const supabase = createClient(
  supabaseUrl || '', 
  supabaseAnonKey || '',
  {
    auth: {
      storage: authStorage,
      persistSession: true,
      autoRefreshToken: true,
    }
  }
);
