'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { dashboardPathForRole } from '@/lib/roles';
import { ensureSellerProfile } from '@/lib/sellerProfile';
import { ensureProfileRow } from '@/lib/profile';
import { describePasswordProblem, isPasswordValid } from '@/lib/passwordPolicy';
import { describeNameProblem, sanitizeName } from '@/lib/fieldRules';
import PasswordRequirements from '@/components/PasswordRequirements';

// Supabase decides how long the emailed code is (Authentication -> Sign In ->
// Email -> Email OTP Length, 6 to 10 digits). Accept the whole range so the
// form keeps working whatever the project is set to.
const CODE_MIN_LENGTH = 6;
const CODE_MAX_LENGTH = 10;
const RESEND_SECONDS = 60;

const inputClass =
  'w-full min-h-[44px] px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-full focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-all text-sm text-gray-900 placeholder-gray-400';

export default function AuthModal({ isOpen, onClose, mode: initialMode = 'login' }) {
  // 'login' | 'signup' | 'verify' | 'forgot' | 'reset'
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [accountType, setAccountType] = useState('customer'); // 'customer' or 'seller'
  const [businessName, setBusinessName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [address, setAddress] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Email verification step
  const [code, setCode] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const codeInputRef = useRef(null);

  const [confirmPassword, setConfirmPassword] = useState('');
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const {
    signIn,
    signUp,
    verifyEmailCode,
    resendEmailCode,
    sendPasswordResetEmail,
    resetPasswordWithCode,
  } = useAuth();

  // Reopening starts fresh. Without this the window stayed on "Create an
  // Account" after it was closed from the sign-up form, and came back there
  // the next time it was opened.
  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setError('');
      setNotice('');
      setPassword('');
      setConfirmPassword('');
      setCode('');
      setCapsLockOn(false);
      setShowPassword(false);
      setAcceptedTerms(false);
    }
  }, [isOpen, initialMode]);

  // Escape closes the sign-in window
  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Countdown before the code can be sent again
  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const timer = setTimeout(() => setResendIn((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  useEffect(() => {
    if (mode === 'verify' || mode === 'reset') codeInputRef.current?.focus();
  }, [mode]);

  if (!isOpen) return null;

  // Typing a password with Caps Lock on is the most common reason a correct
  // password is rejected, and the characters are hidden so nobody notices.
  const trackCapsLock = (event) => {
    if (typeof event.getModifierState !== 'function') return;
    setCapsLockOn(event.getModifierState('CapsLock'));
  };

  const switchMode = (next) => {
    setMode(next);
    setError('');
    setNotice('');
  };

  /** Send the account to the dashboard that matches its role. */
  const goToDashboard = (role) => {
    const path = role === 'customer' ? '/shop' : dashboardPathForRole(role);
    window.location.href = path;
  };

  /** Finish a registration that now has a session (seller row, profile row). */
  const completeRegistration = async (user) => {
    await ensureProfileRow(user);

    if (accountType === 'seller') {
      await ensureSellerProfile(user);
      goToDashboard('seller');
      return;
    }

    goToDashboard('customer');
  };

  const validateSignup = () => {
    const firstNameProblem = describeNameProblem(firstName, 'first name');
    if (firstNameProblem) {
      setError(firstNameProblem);
      return false;
    }

    const lastNameProblem = describeNameProblem(lastName, 'last name');
    if (lastNameProblem) {
      setError(lastNameProblem);
      return false;
    }

    if (accountType === 'seller' && !businessName.trim()) {
      setError('Please enter your shop name.');
      return false;
    }

    if (!acceptedTerms) {
      setError('Please read and accept the Terms of Service and Privacy Policy to continue.');
      return false;
    }

    const passwordProblem = describePasswordProblem(password);
    if (passwordProblem) {
      setError(passwordProblem);
      return false;
    }

    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);

    try {
      if (mode === 'forgot') {
        const { error: resetError } = await sendPasswordResetEmail(email);
        if (resetError) throw resetError;

        setCode('');
        setPassword('');
        setConfirmPassword('');
        setResendIn(RESEND_SECONDS);
        switchMode('reset');
        setNotice(
          `If an account exists for ${email.trim()}, we have emailed you. Tap the "Reset password" link in that email, ` +
            'or, if the email also shows a code, type it below with your new password. Check your spam folder too.'
        );
        return;
      }

      if (mode === 'reset') {
        if (code.replace(/\D/g, '').length < CODE_MIN_LENGTH) {
          setError('Please enter the full code from your email.');
          return;
        }

        const passwordProblem = describePasswordProblem(password);
        if (passwordProblem) {
          setError(passwordProblem);
          return;
        }

        if (password !== confirmPassword) {
          setError('The two passwords do not match.');
          return;
        }

        const { error: resetError } = await resetPasswordWithCode(email, code, password);
        if (resetError) throw resetError;

        setPassword('');
        setConfirmPassword('');
        setCode('');
        switchMode('login');
        setNotice('Your password has been changed. Please sign in with your new password.');
        return;
      }

      if (mode === 'verify') {
        if (code.replace(/\D/g, '').length < CODE_MIN_LENGTH) {
          setError('Please enter the full code from your email.');
          return;
        }

        const { data, error: verifyError } = await verifyEmailCode(email, code);
        if (verifyError) throw verifyError;

        if (data?.user) {
          await completeRegistration(data.user);
          return;
        }

        setNotice('Email verified. You can now sign in.');
        switchMode('login');
        return;
      }

      if (mode === 'login') {
        const { error: signInError, account } = await signIn(email, password);
        if (signInError) throw signInError;

        goToDashboard(account?.role || 'customer');
        return;
      }

      // ----- Registration -----
      if (!validateSignup()) return;

      const sellerMetadata =
        accountType === 'seller'
          ? {
              account_type: 'seller',
              business_name: businessName.trim(),
              contact_phone: contactPhone.trim() || null,
              address: address.trim() || null,
            }
          : {};

      const { data, error: signUpError } = await signUp(
        { email, password, firstName, lastName },
        sellerMetadata
      );
      if (signUpError) throw signUpError;

      // Supabase hides whether an address is taken by returning a user with no
      // identities instead of an error.
      if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        setError('This email is already registered. Please sign in instead, or use "Forgot password?".');
        return;
      }

      // Email confirmation switched off: the account is signed in already.
      if (data?.session && data?.user) {
        await completeRegistration(data.user);
        return;
      }

      // Normal path: a 6-digit code is on its way to the inbox.
      setCode('');
      setResendIn(RESEND_SECONDS);
      switchMode('verify');
      setNotice(`We sent a verification code to ${email.trim()}.`);
    } catch (err) {
      const errorMsg = err.message || '';
      const lowerError = errorMsg.toLowerCase();

      if (lowerError.includes('invalid login credentials')) {
        setError('Incorrect email or password. Please try again, or use "Forgot password?".');
      } else if (lowerError.includes('email not confirmed')) {
        // Take them straight to the code screen instead of leaving them stuck
        // on a login form they cannot pass.
        setCode('');
        setResendIn(0);
        setMode('verify');
        setNotice('');
        setError('This email is not verified yet. Enter the code we emailed you, or tap "Send a new code".');
      } else if (lowerError.includes('token has expired') || lowerError.includes('expired')) {
        setError('That code has expired. Tap "Send a new code" to get a fresh one.');
      } else if (lowerError.includes('invalid') && lowerError.includes('token')) {
        setError('That code is not correct. Please check the email and type the 6 digits again.');
      } else if (lowerError.includes('error sending') || lowerError.includes('confirmation email')) {
        // Supabase created the account but its mail service refused the send,
        // almost always the free-project email limit or a template it cannot
        // render. Send them to the code screen so they can ask for it again.
        setCode('');
        setResendIn(0);
        setMode('verify');
        setNotice('');
        setError(
          'Your account was created, but the verification email could not be sent just now. This is the email service, not your details. Wait a minute and tap "Send a new code".'
        );
      } else if (lowerError.includes('rate limit') || lowerError.includes('email rate limit')) {
        setError('Too many attempts. Please wait 5-10 minutes before trying again.');
      } else if (lowerError.includes('already registered') || lowerError.includes('already exists')) {
        setError('This email is already registered. Please use "Sign In" instead.');
      } else if (lowerError.includes('password') && lowerError.includes('short')) {
        setError(describePasswordProblem(password) || 'Please choose a longer password.');
      } else {
        setError(errorMsg || 'An error occurred. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendIn > 0 || loading) return;

    setError('');
    setNotice('');
    setLoading(true);

    try {
      const { error: resendError } =
        mode === 'reset' ? await sendPasswordResetEmail(email) : await resendEmailCode(email);
      if (resendError) throw resendError;

      setResendIn(RESEND_SECONDS);
      setNotice('A new code is on its way. It can take a minute to arrive.');
    } catch (err) {
      const lowerError = (err.message || '').toLowerCase();
      setError(
        lowerError.includes('rate limit')
          ? 'Please wait a few minutes before asking for another code.'
          : lowerError.includes('error sending') || lowerError.includes('confirmation email')
          ? 'The email service could not send the code. Check Supabase: the free limit is a few emails per hour, and the Confirm signup template must be valid (see EMAIL-VERIFICATION-SETUP.md).'
          : lowerError.includes('not found')
          ? 'No account is waiting for verification on this email. Please sign up again.'
          : err.message || 'Could not send a new code.'
      );
    } finally {
      setLoading(false);
    }
  };

  const title =
    mode === 'login'
      ? 'Welcome Back'
      : mode === 'forgot' || mode === 'reset'
      ? 'Reset Your Password'
      : mode === 'verify'
      ? 'Verify Your Email'
      : 'Create an Account';

  const subtitle =
    mode === 'login'
      ? 'Sign in to continue shopping'
      : mode === 'forgot'
      ? 'Enter your email and we will send you a reset link'
      : mode === 'reset'
      ? 'Use the link in your email, or type the code if your email shows one'
      : mode === 'verify'
      ? 'Enter the code we emailed you'
      : 'Join our e-commerce platform';

  const submitLabel =
    mode === 'login'
      ? 'Log In'
      : mode === 'forgot'
      ? 'Send Reset Code'
      : mode === 'reset'
      ? 'Save New Password'
      : mode === 'verify'
      ? 'Verify Email'
      : 'Sign Up';

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto shadow-2xl relative">
        {/* Header */}
        <div className="p-5 pb-3 text-center border-b border-gray-100">
          <button
            onClick={onClose}
            aria-label="Close sign in"
            className="absolute top-2 right-2 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
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

          <h2 className="text-lg font-bold text-gray-900 mb-1">{title}</h2>
          <p className="text-gray-600 text-xs">{subtitle}</p>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3.5">
          {mode === 'signup' && (
            <>
              {/* Account Type Selector */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-2">Register as</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setAccountType('customer')}
                    aria-pressed={accountType === 'customer'}
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
                      <div className="font-semibold text-sm text-gray-900 mb-0.5">Customer</div>
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
                    aria-pressed={accountType === 'seller'}
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

              {/* First and Last name */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="firstName" className="block text-xs font-semibold text-gray-700 mb-1.5">
                    First Name
                  </label>
                  <input
                    id="firstName"
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(sanitizeName(e.target.value))}
                    autoComplete="given-name"
                    maxLength={60}
                    className={inputClass}
                    placeholder="Juan"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="lastName" className="block text-xs font-semibold text-gray-700 mb-1.5">
                    Last Name
                  </label>
                  <input
                    id="lastName"
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(sanitizeName(e.target.value))}
                    autoComplete="family-name"
                    maxLength={60}
                    className={inputClass}
                    placeholder="Dela Cruz"
                    required
                  />
                </div>
              </div>

              {/* Email */}
              <div>
                <label htmlFor="signupEmail" className="block text-xs font-semibold text-gray-700 mb-1.5">
                  Email
                </label>
                <input
                  id="signupEmail"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  className={inputClass}
                  placeholder="Enter your email"
                  required
                />
              </div>

              {/* Shop Name - shown only for sellers */}
              {accountType === 'seller' && (
                <div>
                  <label htmlFor="businessName" className="block text-xs font-semibold text-gray-700 mb-1.5">
                    Shop Name
                  </label>
                  <input
                    id="businessName"
                    type="text"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    maxLength={120}
                    className={inputClass}
                    placeholder="Enter your shop name"
                    required
                  />
                </div>
              )}
            </>
          )}

          {/* Email field for login and password reset */}
          {(mode === 'login' || mode === 'forgot') && (
            <div>
              <label htmlFor="loginEmail" className="block text-xs font-semibold text-gray-700 mb-1.5">
                Email
              </label>
              <input
                id="loginEmail"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className={inputClass}
                placeholder="Enter your email"
                required
              />
            </div>
          )}

          {/* Verification code (email check and password reset) */}
          {(mode === 'verify' || mode === 'reset') && (
            <div>
              <label htmlFor="verifyCode" className="block text-xs font-semibold text-gray-700 mb-1.5">
                {mode === 'reset' ? 'Reset code' : 'Verification code'}
              </label>
              <input
                id="verifyCode"
                ref={codeInputRef}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={CODE_MAX_LENGTH}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, CODE_MAX_LENGTH))}
                className="w-full min-h-[52px] rounded-2xl border-2 border-gray-200 bg-gray-50 px-4 text-center text-2xl font-bold tracking-[0.3em] text-gray-900 focus:border-transparent focus:ring-2 focus:ring-blue-600"
                placeholder="Enter the code"
                required
              />
              <p className="mt-2 text-xs text-gray-500">
                Sent to <span className="font-semibold text-gray-700">{email.trim()}</span>. Check your spam folder if it
                has not arrived.
              </p>
              <button
                type="button"
                onClick={handleResend}
                disabled={resendIn > 0 || loading}
                className="mt-2 min-h-[36px] text-xs font-semibold text-blue-600 hover:text-blue-700 disabled:text-gray-400"
              >
                {resendIn > 0 ? `Send a new code in ${resendIn}s` : 'Send a new code'}
              </button>
            </div>
          )}

          {/* New password for the reset step */}
          {mode === 'reset' && (
            <div>
              <label htmlFor="newPassword" className="block text-xs font-semibold text-gray-700 mb-1.5">
                New password
              </label>
              <input
                id="newPassword"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyUp={trackCapsLock}
                onKeyDown={trackCapsLock}
                onBlur={() => setCapsLockOn(false)}
                className={inputClass}
                placeholder="Choose a new password"
                autoComplete="new-password"
                required
              />

              <label htmlFor="showResetPassword" className="mt-2 flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  id="showResetPassword"
                  checked={showPassword}
                  onChange={(e) => setShowPassword(e.target.checked)}
                  className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-600 focus:ring-2"
                />
                <span className="ml-2 text-xs font-medium text-gray-700">Show password</span>
              </label>

              {capsLockOn && (
                <p role="status" className="mt-1.5 flex items-center gap-1 text-xs font-medium text-amber-700">
                  <span aria-hidden="true">⇪</span> Caps Lock is on
                </p>
              )}
              <PasswordRequirements value={password} />

              <label htmlFor="confirmPassword" className="mt-3 block text-xs font-semibold text-gray-700 mb-1.5">
                Confirm new password
              </label>
              <input
                id="confirmPassword"
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={inputClass}
                placeholder="Type it again"
                autoComplete="new-password"
                required
              />
            </div>
          )}

          {/* Password */}
          {(mode === 'login' || mode === 'signup') && (
            <div>
              <label htmlFor="password" className="block text-xs font-semibold text-gray-700 mb-1.5">
                Password
              </label>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyUp={trackCapsLock}
                onKeyDown={trackCapsLock}
                onBlur={() => setCapsLockOn(false)}
                className={inputClass}
                placeholder="Enter your password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                aria-describedby={mode === 'signup' ? 'password-rules' : undefined}
              />

              {capsLockOn && (
                <p role="status" className="mt-1.5 flex items-center gap-1 text-xs font-medium text-amber-700">
                  <span aria-hidden="true">⇪</span> Caps Lock is on
                </p>
              )}

              {/* Right under the box it applies to, not further down the form */}
              <label htmlFor="showPassword" className="mt-2 flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  id="showPassword"
                  checked={showPassword}
                  onChange={(e) => setShowPassword(e.target.checked)}
                  className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-600 focus:ring-2"
                />
                <span className="ml-2 text-xs font-medium text-gray-700">Show password</span>
              </label>

              {mode === 'signup' && (
                <div id="password-rules">
                  <PasswordRequirements value={password} />
                </div>
              )}

              {mode === 'login' && (
                <div className="text-right">
                  <button
                    type="button"
                    onClick={() => switchMode('forgot')}
                    className="min-h-[36px] px-1 text-xs font-medium text-blue-600 hover:text-blue-700"
                  >
                    Forgot password?
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Terms, on the screen where an account is created */}
          {mode === 'signup' && (
            <label htmlFor="acceptTerms" className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                id="acceptTerms"
                checked={acceptedTerms}
                onChange={(e) => setAcceptedTerms(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-600"
              />
              <span className="text-xs leading-relaxed text-gray-600">
                I have read and agree to the{' '}
                <a href="/terms" target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-600 hover:underline">
                  Terms of Service
                </a>{' '}
                and{' '}
                <a href="/terms#privacy" target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-600 hover:underline">
                  Privacy Policy
                </a>
                .
              </span>
            </label>
          )}

          {notice && (
            <div role="status" className="p-3 rounded-lg border-2 bg-green-50 border-green-300 text-green-800">
              <div className="flex items-start gap-2">
                <svg className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <p className="text-xs font-medium leading-relaxed">{notice}</p>
              </div>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className={`p-3 rounded-lg border-2 ${
                error.toLowerCase().includes('rate limit') || error.toLowerCase().includes('too many')
                  ? 'bg-yellow-50 border-yellow-300 text-yellow-900'
                  : error.toLowerCase().includes('already registered')
                  ? 'bg-blue-50 border-blue-300 text-blue-800'
                  : 'bg-red-50 border-red-300 text-red-800'
              }`}
            >
              <div className="flex items-start gap-2">
                <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                <div className="flex-1">
                  <p className="text-xs font-medium leading-relaxed">{error}</p>
                  {error.toLowerCase().includes('already registered') && mode === 'signup' && (
                    <button
                      type="button"
                      onClick={() => switchMode('login')}
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
            disabled={
              loading ||
              ((mode === 'signup' || mode === 'reset') && !isPasswordValid(password)) ||
              (mode === 'signup' && !acceptedTerms)
            }
            className="w-full min-h-[44px] bg-blue-600 text-white py-3 rounded-full font-bold hover:bg-blue-700 transition-all shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            {loading ? 'Please wait...' : submitLabel}
          </button>

          {mode === 'login' && (
            <p className="text-center text-[11px] leading-relaxed text-gray-500">
              By signing in you agree to our{' '}
              <a href="/terms" target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-600 hover:underline">
                Terms of Service
              </a>{' '}
              and{' '}
              <a href="/terms#privacy" target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-600 hover:underline">
                Privacy Policy
              </a>
              .
            </p>
          )}

          <div className="text-center pt-1">
            <button
              type="button"
              onClick={() => switchMode(mode === 'signup' ? 'login' : mode === 'login' ? 'signup' : 'login')}
              className="min-h-[44px] px-3 text-xs text-gray-600 hover:text-gray-900 font-medium"
            >
              {mode === 'login'
                ? "Don't have an account? Sign Up"
                : mode === 'signup'
                ? 'Already have an account? Log In'
                : 'Back to Log In'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
