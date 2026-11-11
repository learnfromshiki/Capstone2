'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import PasswordRequirements from '@/components/PasswordRequirements';
import { describePasswordProblem, isPasswordValid } from '@/lib/passwordPolicy';

/**
 * Changing your password, in one card, shared by the customer and seller
 * dashboards.
 *
 * Two ways in:
 *   - you know your password: it is checked before the change, so a tab left
 *     open on someone else's machine cannot take over the account;
 *   - you have forgotten it: we email a code, and the code is typed in right
 *     here. The email also carries a link, but the code works even when the
 *     link lands on the wrong address, which is what used to make this
 *     feel broken.
 */
export default function ChangePasswordCard({ email, title = 'Change Password', description }) {
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState({ type: '', text: '' });

  // The "I forgot it" path
  const [codeSent, setCodeSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [resetForm, setResetForm] = useState({ code: '', next: '', confirm: '' });
  const [resetting, setResetting] = useState(false);

  const inputClass =
    'w-full min-h-[44px] px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500';

  const handleChange = async () => {
    const problem = describePasswordProblem(form.next);
    if (problem) {
      setFeedback({ type: 'error', text: problem });
      return;
    }

    if (form.next !== form.confirm) {
      setFeedback({ type: 'error', text: 'The two new passwords do not match.' });
      return;
    }

    setSaving(true);
    setFeedback({ type: '', text: '' });

    try {
      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email,
        password: form.current,
      });

      if (verifyError) {
        setFeedback({ type: 'error', text: 'Your current password is incorrect.' });
        return;
      }

      const { error } = await supabase.auth.updateUser({ password: form.next });
      if (error) throw error;

      setForm({ current: '', next: '', confirm: '' });
      setFeedback({ type: 'success', text: 'Password updated. Use the new one next time you sign in.' });
    } catch (error) {
      setFeedback({ type: 'error', text: error.message || 'Could not change the password.' });
    } finally {
      setSaving(false);
    }
  };

  const sendCode = async () => {
    setSending(true);
    setFeedback({ type: '', text: '' });

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: typeof window !== 'undefined' ? `${window.location.origin}/reset-password` : undefined,
      });
      if (error) throw error;

      setCodeSent(true);
      setFeedback({
        type: 'success',
        text: `We sent a code to ${email}. Type it below along with your new password. Check your spam folder too.`,
      });
    } catch (error) {
      setFeedback({ type: 'error', text: error.message || 'Could not send the reset email.' });
    } finally {
      setSending(false);
    }
  };

  const useCode = async () => {
    const code = (resetForm.code || '').replace(/\D/g, '');

    if (code.length < 6) {
      setFeedback({ type: 'error', text: 'Please type the code from the email.' });
      return;
    }

    const problem = describePasswordProblem(resetForm.next);
    if (problem) {
      setFeedback({ type: 'error', text: problem });
      return;
    }

    if (resetForm.next !== resetForm.confirm) {
      setFeedback({ type: 'error', text: 'The two new passwords do not match.' });
      return;
    }

    setResetting(true);
    setFeedback({ type: '', text: '' });

    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({ email, token: code, type: 'recovery' });
      if (verifyError) {
        setFeedback({
          type: 'error',
          text: 'That code is wrong or has expired. Send yourself a new one and try again.',
        });
        return;
      }

      const { error } = await supabase.auth.updateUser({ password: resetForm.next });
      if (error) throw error;

      setResetForm({ code: '', next: '', confirm: '' });
      setCodeSent(false);
      setFeedback({ type: 'success', text: 'Password updated. Use the new one next time you sign in.' });
    } catch (error) {
      setFeedback({ type: 'error', text: error.message || 'Could not change the password.' });
    } finally {
      setResetting(false);
    }
  };

  return (
    <div>
      <h4 className="font-semibold text-gray-900 mb-1">{title}</h4>
      <p className="text-sm text-gray-600 mb-4">
        {description || 'You will need your current password, or a code we email you.'}
      </p>

      <div className="max-w-md space-y-3">
        <input
          type={showPassword ? 'text' : 'password'}
          value={form.current}
          onChange={(event) => setForm({ ...form, current: event.target.value })}
          placeholder="Current password"
          autoComplete="current-password"
          aria-label="Current password"
          className={inputClass}
        />

        <div>
          <input
            type={showPassword ? 'text' : 'password'}
            value={form.next}
            onChange={(event) => setForm({ ...form, next: event.target.value })}
            placeholder="New password"
            autoComplete="new-password"
            aria-label="New password"
            className={inputClass}
          />
          <PasswordRequirements value={form.next} />
        </div>

        <input
          type={showPassword ? 'text' : 'password'}
          value={form.confirm}
          onChange={(event) => setForm({ ...form, confirm: event.target.value })}
          placeholder="Confirm new password"
          autoComplete="new-password"
          aria-label="Confirm new password"
          className={inputClass}
        />

        <label className="flex min-h-[44px] cursor-pointer items-center">
          <input
            type="checkbox"
            checked={showPassword}
            onChange={(event) => setShowPassword(event.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-600"
          />
          <span className="ml-2 text-sm font-medium text-gray-700">Show password</span>
        </label>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleChange}
            disabled={saving || !isPasswordValid(form.next)}
            className="min-h-[44px] rounded-lg bg-blue-600 px-6 font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Updating...' : 'Update Password'}
          </button>
          <button
            type="button"
            onClick={sendCode}
            disabled={sending}
            className="min-h-[44px] rounded-lg border-2 border-blue-200 px-5 font-semibold text-blue-600 transition-colors hover:bg-blue-50 disabled:opacity-50"
          >
            {sending ? 'Sending...' : codeSent ? 'Send another code' : 'Forgot password? Email me a code'}
          </button>
        </div>

        {/* The code from the email, typed in right here */}
        {codeSent && (
          <div className="space-y-3 rounded-xl border-2 border-blue-100 bg-blue-50 p-4">
            <p className="text-sm font-semibold text-gray-900">I have the code from the email</p>

            <input
              type="text"
              inputMode="numeric"
              value={resetForm.code}
              onChange={(event) =>
                setResetForm({ ...resetForm, code: event.target.value.replace(/\D/g, '').slice(0, 10) })
              }
              placeholder="Code from the email"
              aria-label="Code from the email"
              className={`${inputClass} tracking-[0.3em]`}
            />

            <div>
              <input
                type={showPassword ? 'text' : 'password'}
                value={resetForm.next}
                onChange={(event) => setResetForm({ ...resetForm, next: event.target.value })}
                placeholder="New password"
                autoComplete="new-password"
                aria-label="New password from code"
                className={inputClass}
              />
              <PasswordRequirements value={resetForm.next} />
            </div>

            <input
              type={showPassword ? 'text' : 'password'}
              value={resetForm.confirm}
              onChange={(event) => setResetForm({ ...resetForm, confirm: event.target.value })}
              placeholder="Confirm new password"
              autoComplete="new-password"
              aria-label="Confirm new password from code"
              className={inputClass}
            />

            <button
              type="button"
              onClick={useCode}
              disabled={resetting || !isPasswordValid(resetForm.next)}
              className="min-h-[44px] w-full rounded-lg bg-blue-600 px-6 font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {resetting ? 'Saving...' : 'Set New Password'}
            </button>
          </div>
        )}

        {feedback.text && (
          <p
            role="status"
            className={`text-sm font-medium ${feedback.type === 'error' ? 'text-red-600' : 'text-green-600'}`}
          >
            {feedback.text}
          </p>
        )}
      </div>
    </div>
  );
}
