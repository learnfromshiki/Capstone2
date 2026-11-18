'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabaseClient';
import { BADGE_CHANGED_EVENT, BADGE_REFRESH_EVENT, fetchBadgeCounts } from './badges';

const POLL_MS = 30000;
const DEBOUNCE_MS = 400;

/**
 * Live badge counts for one dashboard.
 *
 * The counts reload:
 *   - straight away when the database reports a change that can affect them
 *     (Supabase Realtime: a new notification, message, order, shop or stock
 *     change; Row Level Security limits each person to their own rows),
 *   - when this page itself changes something (requestBadgeRefresh()),
 *   - when the tab comes back into view,
 *   - and every 30 seconds as a safety net.
 *
 * @param {'admin'|'seller'|'customer'} audience
 * @param {object} [options]
 * @param {boolean} [options.enabled] - false until the person is signed in
 * @param {string} [options.sellerId] - the seller's shop, to watch its stock
 * @param {() => void} [options.onChange] - also called on every change, so a
 *   page can reload its own lists (the admin's notices, a seller's orders)
 * @returns {{ counts: object|null, refresh: () => Promise<void> }}
 *   counts is null until loaded, or when nav_badge_counts() is not installed
 */
export default function useLiveBadges(audience, { enabled = true, sellerId = null, onChange } = {}) {
  const [counts, setCounts] = useState(null);
  const onChangeRef = useRef(onChange);
  const timerRef = useRef(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const refresh = useCallback(async () => {
    const next = await fetchBadgeCounts(audience);
    setCounts(next);
  }, [audience]);

  // Several changes in a burst (an order and its items) cause one reload.
  const scheduleRefresh = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      refresh();
      onChangeRef.current?.();
      window.dispatchEvent(new Event(BADGE_CHANGED_EVENT));
    }, DEBOUNCE_MS);
  }, [refresh]);

  useEffect(() => {
    if (!enabled) {
      setCounts(null);
      return undefined;
    }

    refresh();

    const poll = setInterval(refresh, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refresh);
    window.addEventListener(BADGE_REFRESH_EVENT, refresh);

    let channel = null;
    let cancelled = false;

    (async () => {
      const { data } = await supabase.auth.getUser();
      const userId = data?.user?.id;
      if (cancelled || !userId) return;

      const watch = (table, filter) => ({
        event: '*',
        schema: 'public',
        table,
        ...(filter ? { filter } : {}),
      });

      channel = supabase.channel(`badges:${audience}:${userId}:${Date.now()}`);
      channel
        .on('postgres_changes', watch('shop_notifications', `user_id=eq.${userId}`), scheduleRefresh)
        .on('postgres_changes', watch('shop_messages'), scheduleRefresh)
        .on('postgres_changes', watch('shop_orders'), scheduleRefresh);

      if (audience === 'admin') {
        channel
          .on('postgres_changes', watch('shop_sellers'), scheduleRefresh)
          .on('postgres_changes', watch('shop_products'), scheduleRefresh);
      }

      if (audience === 'seller' && sellerId) {
        channel.on('postgres_changes', watch('shop_products', `seller_id=eq.${sellerId}`), scheduleRefresh);
      }

      channel.subscribe();
    })();

    return () => {
      cancelled = true;
      clearInterval(poll);
      clearTimeout(timerRef.current);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refresh);
      window.removeEventListener(BADGE_REFRESH_EVENT, refresh);
      if (channel) supabase.removeChannel(channel);
    };
  }, [audience, enabled, sellerId, refresh, scheduleRefresh]);

  return { counts, refresh };
}
