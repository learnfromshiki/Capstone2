'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';

export default function AuthModal({ isOpen, onClose, mode: initialMode = 'login' }) {
  const router = useRouter();
  const [mode, setMode] = useState(initialMode); // 'login' or 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [accountType, setAccountType] = useState('customer'); // 'customer' or 'seller'
  const [businessName, setBusinessName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [address, setAddress] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { signIn, signUp } = useAuth();

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Check if admin credentials - redirect to admin panel
      if (mode === 'login' && email === 'shiki@gmail.com' && password === 'shiki1234') {
        // Store admin credentials for redirect
        sessionStorage.setItem('admin_redirect_email', email);
        sessionStorage.setItem('admin_redirect_password', password);
        // Redirect to admin panel using Next.js router
        router.push('/shop/admin');
        return;
      }

      if (mode === 'login') {
        const { data, error } = await signIn(email, password);
        if (error) throw error;

        // Check if user is a seller and redirect to seller dashboard
        if (data?.user) {
          console.log('Login successful, checking seller profile for user:', data.user.id);
          
          const { data: sellerData, error: sellerError } = await supabase
            .from('shop_sellers')
            .select('*')
            .eq('user_id', data.user.id)
            .maybeSingle(); // Use maybeSingle instead of single to avoid error if not found

          console.log('Seller query result:', { sellerData, sellerError });

          if (sellerData) {
            console.log('User is a seller, redirecting to dashboard...');
            // User is a seller - redirect to seller dashboard
            setLoading(false); // Stop loading state
            window.location.href = '/shop/seller/dashboard'; // Use hard redirect to ensure navigation
            return;
          } else {
            console.log('User is a buyer, staying on shop page');
          }
        }

        // User is a buyer - just close modal and stay on shop page
        onClose();
      } else {
        // Sign up user
        const { data, error } = await signUp(email, password, fullName);
        if (error) throw error;

        // If signing up as seller, create seller record
        if (accountType === 'seller' && data?.user) {
          const { error: sellerError } = await supabase
            .from('shop_sellers')
            .insert([{
              user_id: data.user.id,
              business_name: businessName,
              contact_email: email,
              contact_phone: contactPhone || null,
              address: address || null,
              is_approved: false, // Requires admin approval
              is_active: true
            }]);

          if (sellerError) {
            console.error('Error creating seller account:', sellerError);
            setError('Account created but seller profile failed. Please contact support.');
          } else {
            setError('✅ Seller account created! Awaiting admin approval. Check your email to confirm.');
          }
        } else {
          setError('Check your email to confirm your account!');
        }

        setTimeout(() => {
          setMode('login');
          setError('');
        }, 4000);
      }
    } catch (err) {
      // Handle specific error messages
      const errorMsg = err.message || '';
      const lowerError = errorMsg.toLowerCase();
      
      if (lowerError.includes('rate limit') || lowerError.includes('email rate limit')) {
        setError('⚠️ Rate Limit Reached: Supabase limits signup emails. Please wait 5-10 minutes and try again, or switch to "Sign In" if you already created an account.');
      } else if (lowerError.includes('already registered') || lowerError.includes('already exists')) {
        setError('This email is already registered. Please use "Sign In" instead.');
      } else if (lowerError.includes('invalid') && lowerError.includes('password')) {
        setError('Password must be at least 6 characters long.');
      } else if (lowerError.includes('invalid') && lowerError.includes('email')) {
        setError('Please enter a valid email address.');
      } else {
        setError(errorMsg || 'An error occurred. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl relative">
        {/* Header */}
        <div className="p-5 pb-3 text-center border-b border-gray-100">
          <button
            onClick={onClose}
            className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          
          <div className="w-11 h-11 mx-auto mb-2 bg-gray-100 rounded-xl flex items-center justify-center">
            <svg className="w-6 h-6 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
            </svg>
          </div>
          
          <h2 className="text-lg font-bold text-gray-900 mb-1">
            {mode === 'login' ? 'Welcome Back' : 'Create an Account'}
          </h2>
          <p className="text-gray-600 text-xs">
            {mode === 'login' 
              ? 'Sign in to continue shopping' 
              : 'Join our e-commerce platform'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3.5">
          {mode === 'signup' && (
            <>
              {/* Account Type Selector */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-2">
                  Register as
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setAccountType('customer')}
                    className={`relative p-3 border-2 rounded-xl transition-all ${
                      accountType === 'customer'
                        ? 'border-blue-600 bg-blue-50'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <div className="text-center">
                      <div className="w-9 h-9 mx-auto mb-1 flex items-center justify-center">
                        <svg className="w-6 h-6 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                        </svg>
                      </div>
                      <div className="font-semibold text-sm text-gray-900 mb-0.5">Buyer</div>
                      <div className="text-xs text-gray-600">Shop products</div>
                    </div>
                    {accountType === 'customer' && (
                      <div className="absolute top-2 right-2">
                        <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setAccountType('seller')}
                    className={`relative p-3 border-2 rounded-xl transition-all ${
                      accountType === 'seller'
                        ? 'border-blue-600 bg-blue-50'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <div className="text-center">
                      <div className="w-9 h-9 mx-auto mb-1 flex items-center justify-center">
                        <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                        </svg>
                      </div>
                      <div className="font-semibold text-sm text-gray-900 mb-0.5">Seller</div>
                      <div className="text-xs text-gray-600">Sell products</div>
                    </div>
                    {accountType === 'seller' && (
                      <div className="absolute top-2 right-2">
                        <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}
                  </button>
                </div>
              </div>

              {/* Full Name */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                  Full Name
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-full focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-all text-sm text-gray-900 placeholder-gray-400"
                  placeholder="Enter your full name"
                  required
                />
              </div>

              {/* Email */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-full focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-all text-sm text-gray-900 placeholder-gray-400"
                  placeholder="Enter your email"
                  required
                />
              </div>

              {/* Shop Name - shown only for sellers */}
              {accountType === 'seller' && (
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                    Shop Name
                  </label>
                  <input
                    type="text"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-full focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-all text-sm text-gray-900 placeholder-gray-400"
                    placeholder="Enter your shop name"
                    required
                  />
                </div>
              )}
            </>
          )}

          {/* Email field for login mode */}
          {mode === 'login' && (
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-full focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all text-sm text-gray-900 placeholder-gray-400"
                placeholder="Enter your email"
                required
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-full focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all text-sm text-gray-900 placeholder-gray-400"
                placeholder="••••••••"
                required
                minLength={6}
              />
            </div>
          </div>

          {/* Show Password Checkbox */}
          <div className="flex items-center">
            <input
              type="checkbox"
              id="showPassword"
              checked={showPassword}
              onChange={(e) => setShowPassword(e.target.checked)}
              className="w-3.5 h-3.5 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-600 focus:ring-2"
            />
            <label htmlFor="showPassword" className="ml-2 text-xs font-medium text-gray-700 cursor-pointer">
              Show password
            </label>
          </div>

          {error && (
            <div className={`p-3 rounded-lg border-2 ${
              error.toLowerCase().includes('check your email') 
                ? 'bg-green-50 border-green-300 text-green-800' 
                : error.toLowerCase().includes('rate limit') || error.toLowerCase().includes('⚠️')
                ? 'bg-yellow-50 border-yellow-300 text-yellow-900'
                : error.toLowerCase().includes('already registered')
                ? 'bg-blue-50 border-blue-300 text-blue-800'
                : 'bg-red-50 border-red-300 text-red-800'
            }`}>
              <div className="flex items-start gap-2">
                {error.toLowerCase().includes('check your email') ? (
                  <svg className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                ) : error.toLowerCase().includes('rate limit') || error.toLowerCase().includes('⚠️') ? (
                  <svg className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                ) : error.toLowerCase().includes('already registered') ? (
                  <svg className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                )}
                <div className="flex-1">
                  <p className="text-xs font-medium leading-relaxed">{error}</p>
                  {(error.toLowerCase().includes('rate limit') || error.toLowerCase().includes('⚠️') || error.toLowerCase().includes('already registered')) && mode === 'signup' && (
                    <button
                      type="button"
                      onClick={() => {
                        setMode('login');
                        setError('');
                      }}
                      className="mt-2 text-xs font-bold underline hover:no-underline"
                    >
                      → Switch to Sign In instead
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-3 rounded-full font-bold hover:bg-blue-700 transition-all shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            {loading ? 'Please wait...' : mode === 'login' ? 'Log In' : 'Sign Up'}
          </button>

          <div className="text-center pt-1">
            <button
              type="button"
              onClick={() => {
                setMode(mode === 'login' ? 'signup' : 'login');
                setError('');
              }}
              className="text-xs text-gray-600 hover:text-gray-900 font-medium"
            >
              {mode === 'login' 
                ? "Don't have an account? Sign Up" 
                : 'Already have an account? Log In'}
            </button>
          </div>

          <div className="text-center">
            <button
              type="button"
              onClick={onClose}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Continue as guest
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
