'use client';

import { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';

const SellerAuthContext = createContext({});

export const useSellerAuth = () => useContext(SellerAuthContext);

export const SellerAuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [seller, setSeller] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check active session
    checkUser();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser(session.user);
        fetchSellerProfile(session.user.id);
      } else {
        setUser(null);
        setSeller(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkUser = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
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
      const { data, error } = await supabase
        .from('shop_sellers')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
        throw error;
      }

      let sellerRow = data || null;

      // Seller signup while email confirmation was pending: the row could not be
      // written then (no session). Finish it now that the user is authenticated.
      if (!sellerRow) {
        const { data: { session } } = await supabase.auth.getSession();
        const intent = session?.user?.user_metadata;

        if (intent?.account_type === 'seller' && intent.business_name) {
          const { data: created, error: createError } = await supabase
            .from('shop_sellers')
            .insert({
              user_id: userId,
              business_name: intent.business_name,
              contact_email: session.user.email,
              contact_phone: intent.contact_phone || null,
              address: intent.address || null,
              is_approved: false,
              is_active: true,
            })
            .select()
            .maybeSingle();

          if (createError) {
            console.error('Could not complete the seller profile:', createError);
          } else {
            sellerRow = created;
          }
        }
      }

      setSeller(sellerRow);
    } catch (error) {
      console.error('Error fetching seller profile:', error);
      setSeller(null);
    } finally {
      setLoading(false);
    }
  };

  const signUp = async (email, password, sellerData) => {
    try {
      // Create auth user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: sellerData.businessName,
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

      if (data.user) {
        await fetchSellerProfile(data.user.id);
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
      setUser(null);
      setSeller(null);
    } catch (error) {
      console.error('Error signing out:', error);
    }
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
