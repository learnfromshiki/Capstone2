'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const DURATION = 3500; // how long a toast stays, in ms
const EXIT_MS = 320; // must match .toast-leave in globals.css

const styles = {
  success: { box: 'bg-green-50 border-green-200 text-green-800', bar: 'bg-green-400' },
  error: { box: 'bg-red-50 border-red-200 text-red-800', bar: 'bg-red-400' },
  info: { box: 'bg-blue-50 border-blue-200 text-blue-800', bar: 'bg-blue-400' },
};

const icons = {
  success: (
    <svg className="toast-icon w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
    </svg>
  ),
  error: (
    <svg className="toast-icon w-5 h-5 text-red-600" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
    </svg>
  ),
  info: (
    <svg className="toast-icon w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
    </svg>
  ),
};

/**
 * A small notice in the corner.
 *
 * It springs in from the right, shows a bar counting down the time left,
 * waits while the pointer is over it, then slides out and the toasts below
 * glide up into the space it leaves.
 *
 * Each toast keeps its own timer. Before, the parent passed a new onClose on
 * every render, which restarted every toast's timer whenever another toast
 * appeared, so they piled up instead of leaving one by one.
 */
export default function Toast({ message, type = 'success', onClose }) {
  const [leaving, setLeaving] = useState(false);
  const [paused, setPaused] = useState(false);
  const onCloseRef = useRef(onClose);
  const remainingRef = useRef(DURATION);
  const startedRef = useRef(0);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const dismiss = useCallback(() => {
    setLeaving(true);
  }, []);

  // Remove the toast once the exit animation has played.
  useEffect(() => {
    if (!leaving) return undefined;
    const timer = setTimeout(() => onCloseRef.current?.(), EXIT_MS);
    return () => clearTimeout(timer);
  }, [leaving]);

  // Count down, but not while the pointer rests on the toast.
  useEffect(() => {
    if (leaving || paused) return undefined;
    startedRef.current = Date.now();
    const timer = setTimeout(dismiss, remainingRef.current);
    return () => {
      clearTimeout(timer);
      remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedRef.current));
    };
  }, [leaving, paused, dismiss]);

  const look = styles[type] || styles.info;

  // Positioning belongs to whatever renders the toast (DialogProvider stacks
  // them in the corner), so this component only draws the notice itself.
  return (
    <div className={`toast-slot ${leaving ? 'toast-slot-closing' : ''}`}>
      <div className="toast-slot-inner">
        {/* The spacing lives inside the slot so it collapses with it. */}
        <div className="pb-2">
        <div
          role={type === 'error' ? 'alert' : 'status'}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          className={`${leaving ? 'toast-leave' : 'toast-enter'} relative flex min-w-[280px] max-w-md items-center gap-3 overflow-hidden rounded-lg border px-4 py-3 shadow-lg ${look.box}`}
        >
          <div className="flex-shrink-0">{icons[type] || icons.info}</div>
          <div className="flex-1 text-sm font-medium">{message}</div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss notification"
            className="flex-shrink-0 text-gray-400 transition-colors hover:text-gray-600"
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
          {/* Time left */}
          <span
            aria-hidden="true"
            className={`toast-progress absolute bottom-0 left-0 h-[3px] w-full origin-left opacity-60 ${look.bar}`}
            style={{ animationDuration: `${DURATION}ms`, animationPlayState: paused || leaving ? 'paused' : 'running' }}
          />
        </div>
        </div>
      </div>
    </div>
  );
}
