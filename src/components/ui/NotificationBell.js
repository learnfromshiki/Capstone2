'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The bell in a dashboard header.
 *
 * It opens a list of things that actually need attention rather than jumping
 * to one fixed tab. Each item is
 *   { id, title, detail, tone, onClick }
 * and the caller decides what the items are, because what matters to a shop
 * (orders to pack, questions to answer) is not what matters to an admin
 * (shops waiting for approval).
 */
const TONES = {
  info: 'bg-blue-100 text-blue-700',
  warning: 'bg-yellow-100 text-yellow-700',
  danger: 'bg-red-100 text-red-700',
  success: 'bg-green-100 text-green-700',
};

export default function NotificationBell({ items = [], emptyMessage = 'Nothing needs your attention.' }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  const total = items.reduce((sum, item) => sum + (Number(item.count) || 1), 0);

  // Clicking elsewhere, or Escape, closes the list
  useEffect(() => {
    if (!open) return undefined;

    const handleClick = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) setOpen(false);
    };
    const handleKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={total > 0 ? `${total} notifications` : 'Notifications'}
        aria-expanded={open}
        className="relative flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
      >
        <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {total > 0 && (
          <span className="absolute right-1 top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
          <div className="border-b bg-gray-50 px-4 py-3">
            <p className="text-sm font-bold text-gray-900">Notifications</p>
          </div>

          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-gray-500">{emptyMessage}</p>
          ) : (
            <ul className="max-h-80 divide-y overflow-y-auto">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      if (item.onClick) item.onClick();
                    }}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50"
                  >
                    <span
                      aria-hidden="true"
                      className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm ${
                        TONES[item.tone] || TONES.info
                      }`}
                    >
                      {item.icon || '•'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-gray-900">{item.title}</span>
                      {item.detail && <span className="block text-xs text-gray-600">{item.detail}</span>}
                    </span>
                    {Number(item.count) > 0 && (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-700">
                        {item.count}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
