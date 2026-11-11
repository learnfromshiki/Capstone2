'use client';

import { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';

const AuthContext = createContext({});

export const useAuth = () => useContext(AuthContext);

const fetchProfile = async (userId) => {
  if (!userId) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, user_type, is_suspended, points')
    .eq('id', userId)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    console.error('Error loading the signed-in profile:', error.message);
    return null;
  }

  return data || null;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    // Check active session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!active) return;

      const sessionUser = session?.user ?? null;
      setUser(sessionUser);

      if (sessionUser) {
        const sessionProfile = await fetchProfile(sessionUser.id);
        if (active) setProfile(sessionProfile);
      }
    }).catch((error) => {
      console.error('Could not read the saved session:', error?.message || error);
    }).finally(() => {
      // Always finish loading, or the shop would wait for the session forever
      if (active) setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!active) return;

      const sessionUser = session?.user ?? null;
      setUser(sessionUser);

      if (sessionUser) {
        const sessionProfile = await fetchProfile(sessionUser.id);
        if (active) setProfile(sessionProfile);
      } else {
        setProfile(null);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const signUp = async (email, password, fullName, metadata = {}) => {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            ...metadata,
          }
        }
      });
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  };

  const signIn = async (email, password) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;

      if (data?.user) {
        setUser(data.user);
        setProfile(await fetchProfile(data.user.id));
      }

      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  };

  const signOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (error) {
      console.error('Error signing out:', error);
    } finally {
      setUser(null);
      setProfile(null);
    }
  };

  const value = {
    user,
    profile,
    isSuspended: Boolean(profile?.is_suspended),
    loading,
    signUp,
    signIn,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
