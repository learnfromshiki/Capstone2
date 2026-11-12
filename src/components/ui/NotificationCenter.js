'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ICONS,
  countUnreadNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  timeAgo,
} from '@/lib/notifications';

const POLL_MS = 20000;

const TONES = {
  message: 'bg-blue-100 text-blue-700',
  order: 'bg-green-100 text-green-700',
  review: 'bg-yellow-100 text-yellow-700',
  shop: 'bg-purple-100 text-purple-700',
  account: 'bg-gray-100 text-gray-700',
  info: 'bg-blue-100 text-blue-700',
  warning: 'bg-yellow-100 text-yellow-700',
  danger: 'bg-red-100 text-red-700',
  success: 'bg-green-100 text-green-700',
};

/**
 * The bell every dashboard shares.
 *
 * It shows two things at once:
 *   - what just happened (a message, an order, a review), read from
 *     shop_notifications, which the database fills for whichever side of the
 *     conversation did not cause it; and
 *   - what still needs doing (`items`), which each dashboard works out for
 *     itself: orders to pack for a shop, shops to approve for the admin.
 *
 * `audience` is 'customer', 'seller' or 'admin' and decides which inbox is
 * read, so one person who is both a customer and a shop owner does not see
 * their shop's notifications while they are shopping.
 */
export default function NotificationCenter({
  audience,
  items = [],
  emptyMessage = 'Nothing new. You are all caught up.',
  onNavigate,
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const containerRef = useRef(null);

  const refresh = useCallback(async () => {
    const [rows, count] = await Promise.all([
      listNotifications(audience, 20),
      countUnreadNotifications(audience),
    ]);
    setNotifications(rows);
    setUnread(count);
  }, [audience]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

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

  const attentionTotal = items.reduce((sum, item) => sum + (Number(item.count) || 1), 0);
  const badge = unread + attentionTotal;

  const openNotification = async (notification) => {
    setOpen(false);

    if (!notification.read_at) {
      setNotifications((current) =>
        current.map((row) => (row.id === notification.id ? { ...row, read_at: new Date().toISOString() } : row))
      );
      setUnread((current) => Math.max(0, current - 1));
      await markNotificationRead(notification.id);
    }

    if (!notification.link) return;
    if (onNavigate) onNavigate(notification.link);
    else window.location.href = notification.link;
  };

  const clearAll = async () => {
    setNotifications((current) => current.map((row) => ({ ...row, read_at: row.read_at || new Date().toISOString() })));
    setUnread(0);
    await markAllNotificationsRead(audience);
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={badge > 0 ? `${badge} notifications` : 'Notifications'}
        aria-expanded={open}
        className="relative flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
      >
        <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {badge > 0 && (
          <span className="absolute right-1 top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-[60] mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b bg-gray-50 px-4 py-3">
            <p className="text-sm font-bold text-gray-900">Notifications</p>
            {unread > 0 && (
              <button
                type="button"
                onClick={clearAll}
                className="min-h-[44px] px-2 text-xs font-semibold text-blue-600 hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          {notifications.length === 0 && items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-gray-500">{emptyMessage}</p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              {notifications.length > 0 && (
                <ul className="divide-y">
                  {notifications.map((notification) => (
                    <li key={notification.id}>
                      <button
                        type="button"
                        onClick={() => openNotification(notification)}
                        className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 ${
                          notification.read_at ? '' : 'bg-blue-50/60'
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm ${
                            TONES[notification.kind] || TONES.info
                          }`}
                        >
                          {ICONS[notification.kind] || '🔔'}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={`block text-sm ${notification.read_at ? 'font-medium' : 'font-bold'} text-gray-900`}>
                            {notification.title}
                          </span>
                          {notification.body && (
                            <span className="mt-0.5 block line-clamp-2 text-xs text-gray-600">{notification.body}</span>
                          )}
                          <span className="mt-0.5 block text-[11px] text-gray-400">
                            {timeAgo(notification.created_at)}
                          </span>
                        </span>
                        {!notification.read_at && (
                          <span aria-hidden="true" className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-blue-600" />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {items.length > 0 && (
                <>
                  <p className="border-t bg-gray-50 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-gray-500">
                    Needs your attention
                  </p>
                  <ul className="divide-y">
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
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
