'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSellerAuth } from '@/contexts/SellerAuthContext';
import { useAuth } from '@/contexts/AuthContext';
import Link from 'next/link';
import { describePasswordProblem, isPasswordValid } from '@/lib/passwordPolicy';
import {
  PHONE_HINT,
  describeNameProblem,
  describePhoneProblem,
  sanitizeName,
  sanitizePhone,
} from '@/lib/fieldRules';
import PasswordRequirements from '@/components/PasswordRequirements';
import { ensureSellerProfile } from '@/lib/sellerProfile';
import { ensureProfileRow } from '@/lib/profile';

// Supabase decides how long the emailed code is (6 to 10 digits), so accept
// the whole range rather than assuming one length.
const CODE_MIN_LENGTH = 6;
const CODE_MAX_LENGTH = 10;
const RESEND_SECONDS = 60;

export default function SellerLoginPage() {
  const [mode, setMode] = useState('login'); // 'login' or 'signup'
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    businessName: '',
    phone: '',
    address: '',
    description: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState('');
  const [resendIn, setResendIn] = useState(0);

  const { signIn, signUp, signOut, seller, user } = useSellerAuth();
  const { verifyEmailCode, resendEmailCode } = useAuth();
  const router = useRouter();

  // Redirect if already logged in. The verify step signs the new shop owner in,
  // so it must not be interrupted by this redirect.
  //
  // Only an approved shop has a dashboard. A shop still waiting for the admin
  // stays here, on the portal, and sees the status panel below instead of
  // being handed a dashboard it cannot use yet.
  useEffect(() => {
    if (user && seller && seller.is_approved && mode !== 'verify') {
      router.push('/shop/seller/dashboard');
    }
  }, [user, seller, router, mode]);

  const awaitingApproval = Boolean(user && seller && !seller.is_approved && !seller.is_rejected);
  const wasRejected = Boolean(user && seller?.is_rejected);

  // "Sell on CONNECT-Daet" links here to open an account, so ?mode=signup
  // starts on the registration form instead of the login one.
  useEffect(() => {
    try {
      const requested = new URLSearchParams(window.location.search).get('mode');
      if (requested === 'signup' || requested === 'login') setMode(requested);
    } catch (error) {
      console.error('Could not read the requested mode:', error);
    }
  }, []);

  // Countdown before another code can be requested
  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const timer = setTimeout(() => setResendIn((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;

    // A name takes letters only and a phone number digits only, so the box
    // refuses the wrong character rather than waiting for the submit button.
    const cleaned =
      name === 'firstName' || name === 'lastName'
        ? sanitizeName(value)
        : name === 'phone'
        ? sanitizePhone(value)
        : value;

    setFormData((prev) => ({ ...prev, [name]: cleaned }));
  };

  const handleResend = async () => {
    if (resendIn > 0 || loading) return;

    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const { error: resendError } = await resendEmailCode(formData.email);
      if (resendError) throw resendError;

      setResendIn(RESEND_SECONDS);
      setSuccess('A new code is on its way. It can take a minute to arrive.');
    } catch (err) {
      const lowerError = (err.message || '').toLowerCase();
      setError(
        lowerError.includes('rate limit')
          ? 'Please wait a few minutes before asking for another code.'
          : err.message || 'Could not send a new code.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      if (mode === 'verify') {
        if (code.replace(/\D/g, '').length < CODE_MIN_LENGTH) {
          setError('Please enter the full code from your email.');
          return;
        }

        const { data, error: verifyError } = await verifyEmailCode(formData.email, code);
        if (verifyError) throw verifyError;

        if (data?.user) {
          // The shop row could not be written before the email was verified
          // (there was no session), so finish the registration now.
          await ensureProfileRow(data.user);
          await ensureSellerProfile(data.user);
          // No dashboard yet: the status panel on this page takes over once
          // the shop row is in place.
          setMode('login');
          setSuccess('Email verified. Your shop application is now with the admin for approval.');
          return;
        }

        setSuccess('Email verified. You can now sign in.');
        setMode('login');
        return;
      }

      if (mode === 'login') {
        const { error, seller: sellerRow } = await signIn(formData.email, formData.password);
        if (error) throw error;

        // A customer account does not own a shop: send it back to the shop
        // instead of leaving it bouncing between this form and the dashboard.
        if (!sellerRow) {
          await signOut();
          setError('This is a customer account. Sign in from the shop to keep shopping, or create a seller account here to open a shop.');
          return;
        }

        // An approved shop goes to its dashboard; the effect above handles
        // that. One still waiting stays here and sees the status panel.
        if (sellerRow.is_approved) router.push('/shop/seller/dashboard');
      } else {
        const firstNameProblem = describeNameProblem(formData.firstName, 'first name');
        if (firstNameProblem) {
          setError(firstNameProblem);
          return;
        }

        const lastNameProblem = describeNameProblem(formData.lastName, 'last name');
        if (lastNameProblem) {
          setError(lastNameProblem);
          return;
        }

        const phoneProblem = describePhoneProblem(formData.phone);
        if (phoneProblem) {
          setError(phoneProblem);
          return;
        }

        const passwordProblem = describePasswordProblem(formData.password);
        if (passwordProblem) {
          setError(passwordProblem);
          return;
        }

        const { data: signUpData, error } = await signUp(formData.email, formData.password, {
          firstName: formData.firstName,
          lastName: formData.lastName,
          businessName: formData.businessName,
          phone: formData.phone,
          address: formData.address,
          description: formData.description,
        });

        if (error) throw error;

        if (
          signUpData?.user &&
          Array.isArray(signUpData.user.identities) &&
          signUpData.user.identities.length === 0
        ) {
          setError('This email is already registered. Please sign in instead.');
          setMode('login');
          return;
        }

        // Confirmation turned off means the seller is signed in already. There
        // is still nothing to manage until an admin approves the shop, so the
        // status panel on this page takes over.
        if (signUpData?.session) {
          setMode('login');
          setSuccess('Your shop application has been sent to the admin for approval.');
          return;
        }

        setCode('');
        setResendIn(RESEND_SECONDS);
        setMode('verify');
        setSuccess(`We sent a verification code to ${formData.email.trim()}.`);
      }
    } catch (err) {
      const errorMsg = err.message || '';
      const lowerError = errorMsg.toLowerCase();
      
      if (lowerError.includes('rate limit') || lowerError.includes('email rate limit')) {
        setError('⚠️ Too many attempts. Please wait 5-10 minutes and try again.');
      } else if (lowerError.includes('token has expired') || lowerError.includes('expired')) {
        setError('That code has expired. Tap "Send a new code" to get a fresh one.');
      } else if (lowerError.includes('invalid') && lowerError.includes('token')) {
        setError('That code is not correct. Please check the email and type the 6 digits again.');
      } else if (lowerError.includes('email not confirmed')) {
        setCode('');
        setResendIn(0);
        setMode('verify');
        setSuccess('');
        setError('This email is not verified yet. Enter the code we emailed you, or tap "Send a new code".');
      } else if (lowerError.includes('invalid') && lowerError.includes('credentials')) {
        setError('Invalid email or password. Please try again.');
      } else if (lowerError.includes('already registered')) {
        setError('This email is already registered. Please sign in instead.');
        setMode('login');
      } else {
        setError(errorMsg || 'An error occurred. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50">
      {/* Header */}
      <header className="bg-white border-b shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link href="/shop" className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-700 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                </svg>
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-900">Daet Local Shop</h1>
                <p className="text-xs text-gray-500">Seller Portal</p>
              </div>
            </Link>
            <Link
              href="/shop"
              className="text-sm text-gray-600 hover:text-gray-900 font-medium"
            >
              ← Back to Shop
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-md mx-auto px-4 py-12">
        {/* Where the application stands, for a shop that cannot trade yet */}
        {(awaitingApproval || wasRejected) && (
          <div
            className={`mb-6 rounded-2xl border-2 bg-white p-8 text-center shadow-xl ${
              wasRejected ? 'border-red-200' : 'border-yellow-200'
            }`}
          >
            <div
              className={`mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full ${
                wasRejected ? 'bg-red-100' : 'bg-yellow-100'
              }`}
            >
              <svg
                className={`h-8 w-8 ${wasRejected ? 'text-red-600' : 'text-yellow-600'}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                {wasRejected ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.84-2.75L13.74 4a2 2 0 00-3.5 0L3.16 16.25A2 2 0 005 19z" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                )}
              </svg>
            </div>

            <h2 className="mb-2 text-2xl font-bold text-gray-900">
              {wasRejected ? 'Application Not Approved' : 'Waiting for Approval'}
            </h2>
            <p className="mb-4 text-gray-600">
              {wasRejected
                ? 'Your shop application was reviewed and not approved. Contact CONNECT-Daet support if you would like to re-apply.'
                : 'Your shop has been submitted. An admin reviews every new shop before it opens, and we will email you the moment yours is approved.'}
            </p>

            {wasRejected && seller?.rejection_reason && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-left">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-red-700">Reason</p>
                <p className="break-words text-sm text-red-800">{seller.rejection_reason}</p>
              </div>
            )}

            <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
              <p className="text-xs text-gray-500">Shop</p>
              <p className="break-words text-sm font-semibold text-gray-800">{seller?.business_name}</p>
              <p className="mt-2 text-xs text-gray-500">Signed in as</p>
              <p className="break-words text-sm font-semibold text-gray-800">{user?.email}</p>
            </div>

            <Link
              href="/shop"
              className="flex min-h-[44px] w-full items-center justify-center rounded-lg bg-blue-600 font-semibold text-white transition-colors hover:bg-blue-700"
            >
              Browse the Shop
            </Link>
            <button
              type="button"
              onClick={() => signOut()}
              className="mt-2 min-h-[44px] w-full rounded-lg bg-gray-100 font-semibold text-gray-700 transition-colors hover:bg-gray-200"
            >
              Log Out
            </button>
          </div>
        )}

        <div className={`bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden ${
          awaitingApproval || wasRejected ? 'hidden' : ''
        }`}>
          {/* Header */}
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 p-8 text-white">
            <div className="flex items-center justify-center mb-4">
              <div className="w-16 h-16 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
            </div>
            <h2 className="text-3xl font-bold text-center mb-2">
              {mode === 'login' ? 'Seller Login' : mode === 'verify' ? 'Verify Your Email' : 'Become a Seller'}
            </h2>
            <p className="text-blue-100 text-center text-sm">
              {mode === 'login'
                ? 'Access your seller dashboard'
                : mode === 'verify'
                ? 'Enter the code we emailed you'
                : 'Start selling your products on Daet Local Shop'}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-8 space-y-5">
            {mode === 'signup' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="sellerFirstName" className="block text-sm font-semibold text-gray-700 mb-2">
                      First Name *
                    </label>
                    <input
                      id="sellerFirstName"
                      type="text"
                      name="firstName"
                      value={formData.firstName}
                      onChange={handleInputChange}
                      autoComplete="given-name"
                      maxLength={60}
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Juan"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="sellerLastName" className="block text-sm font-semibold text-gray-700 mb-2">
                      Last Name *
                    </label>
                    <input
                      id="sellerLastName"
                      type="text"
                      name="lastName"
                      value={formData.lastName}
                      onChange={handleInputChange}
                      autoComplete="family-name"
                      maxLength={60}
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Dela Cruz"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Business Name *
                  </label>
                  <input
                    type="text"
                    name="businessName"
                    value={formData.businessName}
                    onChange={handleInputChange}
                    maxLength={120}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Your Shop Name"
                    required={mode === 'signup'}
                  />
                </div>
              </>
            )}

            {mode === 'verify' && (
              <div>
                <label htmlFor="sellerCode" className="block text-sm font-semibold text-gray-700 mb-2">
                  Verification code *
                </label>
                <input
                  id="sellerCode"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={CODE_MAX_LENGTH}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, CODE_MAX_LENGTH))}
                  className="w-full rounded-xl border-2 border-gray-200 px-4 py-4 text-center text-2xl font-bold tracking-[0.3em] focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter the code"
                  required
                />
                <p className="mt-2 text-sm text-gray-500">
                  Sent to <span className="font-semibold text-gray-700">{formData.email.trim()}</span>. Check your spam
                  folder if it has not arrived.
                </p>
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resendIn > 0 || loading}
                  className="mt-2 min-h-[44px] text-sm font-semibold text-blue-600 hover:text-blue-700 disabled:text-gray-400"
                >
                  {resendIn > 0 ? `Send a new code in ${resendIn}s` : 'Send a new code'}
                </button>
              </div>
            )}

            {mode !== 'verify' && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Email *
              </label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="you@example.com"
                required
              />
            </div>
            )}

            {mode !== 'verify' && (
            <div>
              <label htmlFor="sellerPassword" className="block text-sm font-semibold text-gray-700 mb-2">
                Password *
              </label>
              <input
                id="sellerPassword"
                type={showPassword ? 'text' : 'password'}
                name="password"
                value={formData.password}
                onChange={handleInputChange}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="••••••••"
                required
              />

              {mode === 'signup' && <PasswordRequirements value={formData.password} />}

              <label htmlFor="sellerShowPassword" className="mt-2 flex min-h-[44px] cursor-pointer items-center">
                <input
                  type="checkbox"
                  id="sellerShowPassword"
                  checked={showPassword}
                  onChange={(e) => setShowPassword(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-600"
                />
                <span className="ml-2 text-sm font-medium text-gray-700">Show password</span>
              </label>
            </div>
            )}

            {mode === 'signup' && (
              <>
                <div>
                  <label htmlFor="sellerPhone" className="block text-sm font-semibold text-gray-700 mb-2">
                    Mobile Number *
                  </label>
                  <input
                    id="sellerPhone"
                    type="tel"
                    inputMode="numeric"
                    name="phone"
                    value={formData.phone}
                    onChange={handleInputChange}
                    maxLength={11}
                    className="w-full min-h-[44px] px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="09171234567"
                    required
                  />
                  <p className="mt-1 text-xs text-gray-500">{PHONE_HINT}</p>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Business Address
                  </label>
                  <textarea
                    name="address"
                    value={formData.address}
                    onChange={handleInputChange}
                    rows="2"
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Your business location"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Business Description
                  </label>
                  <textarea
                    name="description"
                    value={formData.description}
                    onChange={handleInputChange}
                    rows="3"
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Tell customers about your business..."
                  />
                </div>
              </>
            )}

            {/* Error Message */}
            {error && (
              <div className="p-4 rounded-lg border-2 bg-red-50 border-red-300 text-red-800">
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  <p className="text-sm font-medium">{error}</p>
                </div>
              </div>
            )}

            {/* Success Message */}
            {success && (
              <div className="p-4 rounded-lg border-2 bg-green-50 border-green-300 text-green-800">
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <p className="text-sm font-medium">{success}</p>
                </div>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading || (mode === 'signup' && !isPasswordValid(formData.password))}
              className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white py-4 rounded-xl font-bold text-lg hover:from-blue-700 hover:to-blue-800 transition-all shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading
                ? 'Please wait...'
                : mode === 'login'
                ? 'Sign In'
                : mode === 'verify'
                ? 'Verify Email'
                : 'Create Seller Account'}
            </button>

            {/* Toggle Mode */}
            <div className="text-center pt-4 border-t">
              <button
                type="button"
                onClick={() => {
                  setMode(mode === 'login' ? 'signup' : 'login');
                  setError('');
                  setSuccess('');
                }}
                className="min-h-[44px] text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                {mode === 'login'
                  ? "Don't have a seller account? Sign up"
                  : mode === 'verify'
                  ? 'Back to Sign in'
                  : 'Already have an account? Sign in'}
              </button>
            </div>
          </form>
        </div>

        {/* Info Card */}
        <div className="mt-8 bg-white rounded-xl shadow-md border border-gray-200 p-6">
          <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            Why Sell with Us?
          </h3>
          <ul className="space-y-2 text-sm text-gray-600">
            <li className="flex items-start gap-2">
              <svg className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span>Reach local customers in Daet and beyond</span>
            </li>
            <li className="flex items-start gap-2">
              <svg className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span>Easy-to-use dashboard to manage products</span>
            </li>
            <li className="flex items-start gap-2">
              <svg className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span>Track your sales and earnings in real-time</span>
            </li>
            <li className="flex items-start gap-2">
              <svg className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span>Platform fee: Only 15% commission per sale</span>
            </li>
          </ul>
        </div>
      </main>
    </div>
  );
}
