'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import PasswordRequirements from '@/components/PasswordRequirements';
import { describePasswordProblem, isPasswordValid } from '@/lib/passwordPolicy';

/**
 * Landing page for the "Forgot password?" email. Supabase signs the visitor in
 * with a short-lived recovery session from the link, then they choose a new
 * password here.
 */
export default function ResetPasswordPage() {
  const [status, setStatus] = useState('checking'); // checking | ready | invalid | done
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const fail = (message) => {
      if (cancelled) return;
      setError(message || '');
      setStatus('invalid');
    };

    (async () => {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const query = new URLSearchParams(window.location.search);

      // An expired or already-used link comes back with the error in the URL
      const linkError = hash.get('error_description') || query.get('error_description');
      if (linkError) {
        fail(linkError.replace(/\+/g, ' '));
        return;
      }

      // Supabase sends one of three shapes depending on the project's email
      // template and auth flow. Handle all of them, and always prefer the token
      // in the link over any session this browser already has, so opening the
      // link while signed in as someone else cannot change the wrong password.
      try {
        const tokenHash = query.get('token_hash') || query.get('token');
        const type = query.get('type') || 'recovery';

        if (tokenHash) {
          const { error: otpError } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
          if (otpError) {
            fail(otpError.message);
            return;
          }
          if (!cancelled) setStatus('ready');
          return;
        }

        const code = query.get('code');
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) {
            fail(exchangeError.message);
            return;
          }
          if (!cancelled) setStatus('ready');
          return;
        }

        const accessToken = hash.get('access_token');
        const refreshToken = hash.get('refresh_token');
        if (accessToken && refreshToken) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (sessionError) {
            fail(sessionError.message);
            return;
          }
          if (!cancelled) setStatus('ready');
          return;
        }

        // No token in the link: supabase-js may still be reading it, or the
        // page was opened directly while a recovery session is already active.
        const { data } = await supabase.auth.getSession();
        if (data?.session) {
          if (!cancelled) setStatus('ready');
          return;
        }

        setTimeout(async () => {
          if (cancelled) return;
          const { data: retry } = await supabase.auth.getSession();
          if (cancelled) return;
          if (retry?.session) {
            setStatus('ready');
          } else {
            fail('');
          }
        }, 2000);
      } catch (unexpected) {
        fail(unexpected?.message || '');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    const passwordProblem = describePasswordProblem(password);
    if (passwordProblem) {
      setError(passwordProblem);
      return;
    }

    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }

    setSaving(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      // Sign out of the recovery session so the next login uses the new password
      await supabase.auth.signOut();
      setStatus('done');
    } catch (updateError) {
      setError(updateError.message || 'Could not update your password. Please request a new link.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h1 className="text-xl font-bold text-gray-900 text-center">Choose a New Password</h1>

        {status === 'checking' && (
          <p className="mt-6 text-center text-sm text-gray-600">Checking your reset link...</p>
        )}

        {status === 'invalid' && (
          <div className="mt-6 space-y-4 text-center">
            <p className="text-sm text-red-700">
              {error || 'This reset link is invalid or has expired.'} Please request a new one from the Sign In
              window using &quot;Forgot password?&quot;.
            </p>
            <Link href="/shop" className="inline-block rounded-full bg-blue-600 px-6 py-3 text-sm font-bold text-white hover:bg-blue-700">
              Back to the Shop
            </Link>
          </div>
        )}

        {status === 'done' && (
          <div className="mt-6 space-y-4 text-center">
            <p className="text-sm text-green-700">Your password has been changed. You can now sign in with it.</p>
            <Link href="/shop" className="inline-block rounded-full bg-blue-600 px-6 py-3 text-sm font-bold text-white hover:bg-blue-700">
              Go to the Shop
            </Link>
          </div>
        )}

        {status === 'ready' && (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="new-password" className="mb-1.5 block text-xs font-semibold text-gray-700">
                New password
              </label>
              <input
                id="new-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                required
                className="w-full min-h-[44px] rounded-full border border-gray-200 bg-gray-50 px-4 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-600"
              />
              <PasswordRequirements value={password} />
            </div>
            <div>
              <label htmlFor="confirm-password" className="mb-1.5 block text-xs font-semibold text-gray-700">
                Confirm new password
              </label>
              <input
                id="confirm-password"
                type={showPassword ? 'text' : 'password'}
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                autoComplete="new-password"
                required
                className="w-full min-h-[44px] rounded-full border border-gray-200 bg-gray-50 px-4 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-600"
              />
            </div>
            <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-xs font-medium text-gray-700">
              <input
                type="checkbox"
                checked={showPassword}
                onChange={(event) => setShowPassword(event.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600"
              />
              Show password
            </label>
            {error && (
              <p role="alert" className="rounded-lg border-2 border-red-300 bg-red-50 p-3 text-xs text-red-800">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={saving || !isPasswordValid(password)}
              className="w-full min-h-[44px] rounded-full bg-blue-600 font-bold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save New Password'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
