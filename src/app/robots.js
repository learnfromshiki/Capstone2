import { SITE_URL } from '@/lib/publicData.server';

/** /robots.txt: the shop is public; accounts, dashboards and checkout are not. */
export default function robots() {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/shop', '/shop/product/'],
        disallow: ['/shop/admin', '/shop/seller', '/shop/buyer', '/shop/checkout', '/api/', '/reset-password'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
