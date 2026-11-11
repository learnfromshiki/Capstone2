'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { DEFAULT_SHOP_SETTINGS, fetchShopSettings } from '@/lib/shopSettings';

/**
 * Storefront footer with the contact details the admin saved in
 * Admin -> Settings, so buyers always know how to reach the shop.
 */
export default function ShopFooter() {
  const [settings, setSettings] = useState(DEFAULT_SHOP_SETTINGS);

  useEffect(() => {
    let cancelled = false;
    fetchShopSettings().then((value) => {
      if (!cancelled && value) setSettings(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const phoneHref = settings.contactPhone ? `tel:${settings.contactPhone.replace(/[^\d+]/g, '')}` : null;

  return (
    <footer className="border-t bg-white">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 text-sm text-gray-600 sm:grid-cols-3 sm:px-6 lg:px-8">
        <div>
          <p className="text-base font-bold text-gray-900">{settings.siteName || 'Daet Local Shop'}</p>
          <p className="mt-2">
            Authentic handicrafts, food and pasalubong from the artisans of Daet, Camarines Norte.
          </p>
        </div>

        <div>
          <p className="font-semibold text-gray-900">Customer care</p>
          <ul className="mt-2 space-y-1">
            {settings.contactEmail && (
              <li>
                <a className="hover:text-blue-600 break-all" href={`mailto:${settings.contactEmail}`}>
                  {settings.contactEmail}
                </a>
              </li>
            )}
            {phoneHref && (
              <li>
                <a className="hover:text-blue-600" href={phoneHref}>
                  {settings.contactPhone}
                </a>
              </li>
            )}
            <li>Payment: GCash, Bank Transfer, Cash on Delivery</li>
          </ul>
        </div>

        <div>
          <p className="font-semibold text-gray-900">Links</p>
          <ul className="mt-2 space-y-1">
            <li>
              <Link className="hover:text-blue-600" href="/shop">
                Shop all products
              </Link>
            </li>
            <li>
              <Link className="hover:text-blue-600" href="/shop/buyer?tab=orders">
                Track my orders
              </Link>
            </li>
            <li>
              {/* Straight to the seller sign-up form, not the login screen */}
              <Link className="hover:text-blue-600" href="/shop/seller?mode=signup">
                Sell on CONNECT-Daet
              </Link>
            </li>
            <li>
              <Link className="hover:text-blue-600" href="/terms">
                Terms &amp; Privacy
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <p className="border-t py-4 text-center text-xs text-gray-500">
        © {new Date().getFullYear()} CONNECT-Daet.ph · Supporting local artisans of Daet
      </p>
    </footer>
  );
}
