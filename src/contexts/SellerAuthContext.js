'use client';

import { createContext, useContext, useState, useEffect } from 'react';
import { supabase, clearStoredSession } from '@/lib/supabaseClient';
import { ensureSellerProfile } from '@/lib/sellerProfile';
import { ensureProfileRow, joinName } from '@/lib/profile';
import { resolveAccount } from '@/lib/roles';

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

const SellerAuthContext = createContext({});

export const useSellerAuth = () => useContext(SellerAuthContext);

export const SellerAuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [seller, setSeller] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check active session
    checkUser();

    // Listen for auth changes. Supabase warns that awaiting auth calls inside
    // this callback can deadlock, so defer the profile check to the next tick.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setTimeout(() => {
          checkUser();
        }, 0);
      } else {
        setUser(null);
        setSeller(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkAccountIsActive = async (userId) => {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('is_suspended')
      .eq('id', userId)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.warn('Could not check account status:', error.message);
      return true;
    }

    return !profile?.is_suspended;
  };

  const checkUser = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        if (!(await checkAccountIsActive(session.user.id))) {
          await supabase.auth.signOut();
          setUser(null);
          setSeller(null);
          setLoading(false);
          return;
        }

        setUser(session.user);
        await fetchSellerProfile(session.user.id);
      } else {
        setLoading(false);
      }
    } catch (error) {
      console.error('Error checking user:', error);
      setLoading(false);
    }
  };

  const fetchSellerProfile = async (userId) => {
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      const account = await resolveAccount(currentUser?.id === userId ? currentUser : { id: userId });

      let sellerRow = account.seller;

      // Seller signup while email confirmation was pending: the row could not be
      // written then (no session). Finish it now that the user is authenticated.
      if (!sellerRow && account.role === 'seller') {
        sellerRow = await ensureSellerProfile(currentUser);
      }

      setSeller(sellerRow);
      return sellerRow;
    } catch (error) {
      console.error('Error fetching seller profile:', error);
      setSeller(null);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const signUp = async (email, password, sellerData) => {
    try {
      const firstName = (sellerData.firstName || '').trim();
      const lastName = (sellerData.lastName || '').trim();
      // The owner's own name goes on the profile; the shop name belongs to the
      // shop_sellers row, so the two are never confused in the admin lists.
      const ownerName = joinName(firstName, lastName) || sellerData.businessName;

      // Create auth user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: (email || '').trim(),
        password,
        options: {
          data: {
            first_name: firstName,
            last_name: lastName,
            full_name: ownerName,
            account_type: 'seller',
            business_name: sellerData.businessName,
            contact_phone: sellerData.phone || null,
            address: sellerData.address || null,
          }
        }
      });

      if (authError) throw authError;

      // Create seller profile. With email confirmation pending there is no session
      // yet, so the insert is expected to be deferred to the first sign-in.
      if (authData.user) {
        const { data: sellerProfile, error: sellerError } = await supabase
          .from('shop_sellers')
          .insert({
            user_id: authData.user.id,
            business_name: sellerData.businessName,
            contact_email: email,
            contact_phone: sellerData.phone || null,
            address: sellerData.address || null,
            description: sellerData.description || null,
          })
          .select()
          .maybeSingle();

        // Record the account as a seller even when the shop row has to wait for the
        // first sign-in (email confirmation pending), so it is never a buyer account.
        await ensureProfileRow(authData.user);
        await ensureSellerProfile(authData.user);

        if (sellerError) {
          console.warn('Seller profile deferred until first sign-in:', sellerError.message);
        } else if (sellerProfile) {
          setSeller(sellerProfile);
        }
      }

      return { data: authData, error: null };
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

      let sellerRow = null;

      if (data.user) {
        if (!(await checkAccountIsActive(data.user.id))) {
          await supabase.auth.signOut();
          throw new Error('This account has been suspended. Please contact CONNECT-Daet support.');
        }

        await ensureProfileRow(data.user);
        sellerRow = await fetchSellerProfile(data.user.id);

        // Registered as a seller but the shop row is still missing: create it
        // now rather than letting the portal treat the account as a customer.
        if (!sellerRow && data.user.user_metadata?.account_type === 'seller') {
          sellerRow = await ensureSellerProfile(data.user);
          setSeller(sellerRow);
        }
      }

      // The caller needs the seller row to tell a real shop apart from a buyer account
      return { data, error: null, seller: sellerRow };
    } catch (error) {
      return { data: null, error };
    }
  };

  /**
   * Clear the local session first so the dashboard can never keep showing a
   * signed-in shop when the network call is slow or the token has already
   * expired on the server.
   */
  const signOut = async () => {
    setUser(null);
    setSeller(null);
    setLoading(false);

    try {
      const { error } = await supabase.auth.signOut();
      if (error && !isAlreadySignedOut(error)) {
        const { error: localError } = await supabase.auth.signOut({ scope: 'local' });
        if (localError) console.error('Error signing out:', localError.message);
      }
    } catch (error) {
      if (!isAlreadySignedOut(error)) console.error('Error signing out:', error);
    }

    // Drop anything left in this browser so a reload cannot restore the session.
    clearStoredSession();
  };

  const updateSellerProfile = async (updates) => {
    try {
      if (!seller) throw new Error('No seller profile found');

      const { data, error } = await supabase
        .from('shop_sellers')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq('id', seller.id)
        .select()
        .single();

      if (error) throw error;

      setSeller(data);
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  };

  const value = {
    user,
    seller,
    loading,
    signUp,
    signIn,
    signOut,
    updateSellerProfile,
    refreshSellerProfile: () => user && fetchSellerProfile(user.id),
  };

  return (
    <SellerAuthContext.Provider value={value}>
      {children}
    </SellerAuthContext.Provider>
  );
};
