'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Opens the product in the shop right away, for people (not link previews). */
export default function OpenInShop({ href }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(href);
  }, [href, router]);
  return null;
}
