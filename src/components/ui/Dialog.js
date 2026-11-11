'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import Toast from '@/components/Toast';

/**
 * One notification system for the whole site.
 *
 * It replaces the browser's own alert() and confirm() boxes, which showed the
 * Vercel address in a grey system dialog, could not be styled, and blocked the
 * whole tab until dismissed.
 *
 *   showAlert('Something went wrong')          - modal with an OK button
 *   showAlert({ title, message, tone })        - same, with a heading
 *   await showConfirm('Delete this?')          - modal with Cancel/Confirm, resolves true or false
 *   showToast('Saved', 'success')              - small notice in the corner, fades by itself
 *
 * Errors and decisions use the modal because they must be read. Routine
 * successes use a toast, so nobody has to dismiss a box after every save.
 */
const DialogContext = createContext(null);

export const useDialog = () => {
  const context = useContext(DialogContext);

  // A component used outside the provider should not crash the page.
  if (!context) {
    return {
      showAlert: (input) => {
        console.warn('Dialog provider missing:', input);
        return Promise.resolve();
      },
      showConfirm: () => Promise.resolve(false),
      showToast: (message) => console.warn('Dialog provider missing:', message),
    };
  }

  return context;
};

const TONE_STYLES = {
  info: { ring: 'bg-blue-100 text-blue-600', button: 'bg-blue-600 hover:bg-blue-700', icon: 'i' },
  success: { ring: 'bg-green-100 text-green-600', button: 'bg-green-600 hover:bg-green-700', icon: '✓' },
  error: { ring: 'bg-red-100 text-red-600', button: 'bg-red-600 hover:bg-red-700', icon: '!' },
  warning: { ring: 'bg-yellow-100 text-yellow-700', button: 'bg-yellow-600 hover:bg-yellow-700', icon: '!' },
  question: { ring: 'bg-blue-100 text-blue-600', button: 'bg-blue-600 hover:bg-blue-700', icon: '?' },
};

/** Accept either a plain string or a full options object. */
const toOptions = (input, fallback = {}) =>
  typeof input === 'string' ? { ...fallback, message: input } : { ...fallback, ...(input || {}) };

export function DialogProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const [toasts, setToasts] = useState([]);
  const confirmButtonRef = useRef(null);
  const toastId = useRef(0);

  const showAlert = useCallback(
    (input) =>
      new Promise((resolve) => {
        const options = toOptions(input, { tone: 'error', confirmLabel: 'OK' });
        setDialog({ ...options, kind: 'alert', resolve });
      }),
    []
  );

  const showConfirm = useCallback(
    (input) =>
      new Promise((resolve) => {
        const options = toOptions(input, {
          tone: 'question',
          confirmLabel: 'Confirm',
          cancelLabel: 'Cancel',
        });
        setDialog({ ...options, kind: 'confirm', resolve });
      }),
    []
  );

  const showToast = useCallback((message, type = 'success') => {
    toastId.current += 1;
    const id = toastId.current;
    setToasts((current) => [...current, { id, message, type }]);
  }, []);

  const close = useCallback(
    (result) => {
      setDialog((current) => {
        if (current?.resolve) current.resolve(result);
        return null;
      });
    },
    []
  );

  // Escape cancels, Enter confirms
  useEffect(() => {
    if (!dialog) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(false);
      }
      if (event.key === 'Enter' && event.target?.tagName !== 'TEXTAREA') {
        event.preventDefault();
        close(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    confirmButtonRef.current?.focus();
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dialog, close]);

  const tone = TONE_STYLES[dialog?.tone] || TONE_STYLES.info;

  return (
    <DialogContext.Provider value={{ showAlert, showConfirm, showToast }}>
      {children}

      {dialog && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => close(false)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label={dialog.title || 'Notice'}
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
          >
            <div className="flex gap-4">
              <div
                aria-hidden="true"
                className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-xl font-bold ${tone.ring}`}
              >
                {dialog.icon || tone.icon}
              </div>

              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-bold text-gray-900">
                  {dialog.title || (dialog.kind === 'confirm' ? 'Please confirm' : 'Notice')}
                </h2>
                <p className="mt-1 whitespace-pre-line break-words text-sm leading-relaxed text-gray-600">
                  {dialog.message}
                </p>
              </div>
            </div>

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              {dialog.kind === 'confirm' && (
                <button
                  type="button"
                  onClick={() => close(false)}
                  className="min-h-[44px] rounded-xl border-2 border-gray-200 px-5 font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                >
                  {dialog.cancelLabel || 'Cancel'}
                </button>
              )}
              <button
                type="button"
                ref={confirmButtonRef}
                onClick={() => close(true)}
                className={`min-h-[44px] rounded-xl px-6 font-bold text-white transition-colors ${tone.button}`}
              >
                {dialog.confirmLabel || 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toasts stack down the corner so a second one does not hide the first */}
      <div className="pointer-events-none fixed right-0 top-4 z-[210] flex flex-col items-end gap-2 px-4">
        {toasts.map((item) => (
          <div key={item.id} className="pointer-events-auto">
            <Toast
              message={item.message}
              type={item.type}
              onClose={() => setToasts((current) => current.filter((entry) => entry.id !== item.id))}
            />
          </div>
        ))}
      </div>
    </DialogContext.Provider>
  );
}
