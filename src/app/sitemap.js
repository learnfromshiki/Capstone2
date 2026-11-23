import { SITE_URL, listPublicProducts } from '@/lib/publicData.server';

/** /sitemap.xml: the public pages and every listed product, for search engines. */
export const revalidate = 3600;

export default async function sitemap() {
  const products = await listPublicProducts();
  return [
    { url: `${SITE_URL}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/shop`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${SITE_URL}/terms`, changeFrequency: 'yearly', priority: 0.2 },
    ...products.map((product) => ({
      url: `${SITE_URL}/shop/product/${product.id}`,
      lastModified: product.updated_at ? new Date(product.updated_at) : undefined,
      changeFrequency: 'weekly',
      priority: 0.7,
    })),
  ];
}
