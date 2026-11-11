'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase, clearStoredSession } from '@/lib/supabaseClient';
import { resolveAccount } from '@/lib/roles';
import { ensureProfileRow, joinName } from '@/lib/profile';

const AuthContext = createContext({});

export const useAuth = () => useContext(AuthContext);

/** A sign-out that fails because the session is already gone is still a success. */
const isAlreadySignedOut = (error) => {
  const message = (error?.message || '').toLowerCase();
  return (
    error?.name === 'AuthSessionMissingError' ||
    message.includes('session missing') ||
    message.includes('session_id claim') ||
    message.includes('session not found') ||
    error?.status === 403
  );
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [seller, setSeller] = useState(null);
  const [role, setRole] = useState('customer');
  const [loading, setLoading] = useState(true);

  const applyAccount = useCallback(async (sessionUser) => {
    if (!sessionUser) {
      setProfile(null);
      setSeller(null);
      setRole('customer');
      return null;
    }

    const account = await resolveAccount(sessionUser);
    setProfile(account.profile);
    setSeller(account.seller);
    setRole(account.role);
    return account;
  }, []);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!active) return;

      const sessionUser = session?.user ?? null;
      setUser(sessionUser);
      await applyAccount(sessionUser);
    }).catch((error) => {
      console.error('Could not read the saved session:', error?.message || error);
    }).finally(() => {
      // Always finish loading, or the shop would wait for the session forever
      if (active) setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;

      const sessionUser = session?.user ?? null;
      setUser(sessionUser);

      if (event === 'SIGNED_OUT' || !sessionUser) {
        setProfile(null);
        setSeller(null);
        setRole('customer');
        return;
      }

      // Supabase warns that awaiting its calls inside this callback can
      // deadlock, so the role lookup runs on the next tick.
      setTimeout(() => {
        if (active) applyAccount(sessionUser);
      }, 0);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [applyAccount]);

  /**
   * @param {object} details - { email, password, firstName, lastName }
   * @param {object} [metadata] - extra user_metadata (seller registrations)
   */
  const signUp = async ({ email, password, firstName, lastName }, metadata = {}) => {
    try {
      const cleanFirst = (firstName || '').trim();
      const cleanLast = (lastName || '').trim();

      const { data, error } = await supabase.auth.signUp({
        email: (email || '').trim(),
        password,
        options: {
          data: {
            first_name: cleanFirst,
            last_name: cleanLast,
            // full_name is what the dashboards, orders and admin lists display.
            full_name: joinName(cleanFirst, cleanLast),
            ...metadata,
          },
        },
      });
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  };

  /**
   * Confirm a registration with the 6-digit code emailed to the address.
   * Supabase calls this an OTP; older projects label the same token 'signup'.
   */
  const verifyEmailCode = async (email, token) => {
    const cleanEmail = (email || '').trim();
    const cleanToken = (token || '').replace(/\D/g, '');

    try {
      let { data, error } = await supabase.auth.verifyOtp({
        email: cleanEmail,
        token: cleanToken,
        type: 'signup',
      });

      // Projects that send a magic-link style token report the signup type as
      // invalid; the same code verifies as type 'email'.
      if (error) {
        const retry = await supabase.auth.verifyOtp({
          email: cleanEmail,
          token: cleanToken,
          type: 'email',
        });
        if (!retry.error) {
          data = retry.data;
          error = null;
        }
      }

      if (error) throw error;

      if (data?.user) {
        await ensureProfileRow(data.user);
        setUser(data.user);
        await applyAccount(data.user);
      }

      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  };

  /** Send the verification code again. */
  const resendEmailCode = async (email) => {
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: (email || '').trim(),
      });
      if (error) throw error;
      return { error: null };
    } catch (error) {
      return { error };
    }
  };

  const signIn = async (email, password) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: (email || '').trim(),
        password,
      });
      if (error) throw error;

      if (!data?.user) throw new Error('Could not sign in. Please try again.');

      // Restore a missing profiles row before anything reads it
      await ensureProfileRow(data.user);

      const account = await resolveAccount(data.user);

      if (account.isSuspended) {
        await signOut({ redirectTo: null });
        return {
          data: null,
          error: new Error('This account has been suspended. Please contact CONNECT-Daet support.'),
        };
      }

      if (account.role === 'seller' && account.seller?.is_active === false) {
        await signOut({ redirectTo: null });
        return {
          data: null,
          error: new Error('This seller account has been suspended. Please contact CONNECT-Daet support.'),
        };
      }

      setUser(data.user);
      setProfile(account.profile);
      setSeller(account.seller);
      setRole(account.role);

      return { data, error: null, account };
    } catch (error) {
      return { data: null, error };
    }
  };

  /**
   * Sign out everywhere in the app.
   *
   * The local state is cleared first so the header can never keep showing a
   * signed-in menu when the network call is slow or fails, and a session that
   * has already expired is treated as a completed sign-out instead of an error.
   */
  const signOut = async ({ redirectTo = '/shop' } = {}) => {
    setUser(null);
    setProfile(null);
    setSeller(null);
    setRole('customer');

    try {
      const { error } = await supabase.auth.signOut();
      if (error && !isAlreadySignedOut(error)) {
        // The refresh token was rejected by the server; drop this browser's
        // copy so a reload cannot resurrect the session.
        const { error: localError } = await supabase.auth.signOut({ scope: 'local' });
        if (localError) console.error('Error signing out:', localError.message);
      }
    } catch (error) {
      if (!isAlreadySignedOut(error)) console.error('Error signing out:', error);
    }

    // Drop anything left in this browser so a reload cannot restore the session.
    clearStoredSession();

    if (redirectTo && typeof window !== 'undefined') {
      // A full navigation, so no page keeps stale signed-in data in memory.
      window.location.href = redirectTo;
    }
  };

  const refreshAccount = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const sessionUser = session?.user ?? null;
    setUser(sessionUser);
    return applyAccount(sessionUser);
  }, [applyAccount]);

  const value = {
    user,
    profile,
    seller,
    role,
    isSuspended: Boolean(profile?.is_suspended),
    loading,
    signUp,
    signIn,
    signOut,
    verifyEmailCode,
    resendEmailCode,
    refreshAccount,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
