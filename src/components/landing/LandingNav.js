'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

/** Top bar that turns frosted and gains a shadow once the page scrolls. */
export default function LandingNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav
      className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'border-b border-gray-200/70 bg-white/80 shadow-sm backdrop-blur-lg'
          : 'border-b border-transparent bg-transparent'
      }`}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" aria-label="CONNECT-Daet home" className="group flex items-center gap-3 animate-fade-down">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-blue-700 shadow-lg shadow-blue-600/30 transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110">
            <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
            </svg>
          </span>
          <span className="whitespace-nowrap text-lg font-extrabold tracking-tight text-gray-900 sm:text-2xl">
            CONNECT<span className="text-blue-600">-Daet</span>
          </span>
        </Link>

        <div className="hidden items-center gap-8 text-sm font-medium text-gray-600 md:flex">
          {[
            ['#features', 'Why us'],
            ['#categories', 'Categories'],
            ['#how-it-works', 'How it works'],
          ].map(([href, label]) => (
            <a key={href} href={href} className="group relative py-2 transition-colors hover:text-gray-900">
              {label}
              <span className="absolute inset-x-0 -bottom-0.5 h-0.5 origin-left scale-x-0 rounded-full bg-blue-600 transition-transform duration-300 group-hover:scale-x-100" />
            </a>
          ))}
        </div>

        <Link
          href="/shop"
          className="group inline-flex min-h-[44px] items-center gap-2 whitespace-nowrap rounded-full bg-gray-900 px-4 text-sm sm:px-5 font-semibold text-white shadow-lg shadow-gray-900/20 transition-all duration-300 hover:bg-blue-600 hover:shadow-blue-600/30 animate-fade-down"
        >
          <span className="hidden sm:inline">Start Shopping</span>
          <span className="sm:hidden">Shop</span>
          <svg className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </Link>
      </div>
    </nav>
  );
}
