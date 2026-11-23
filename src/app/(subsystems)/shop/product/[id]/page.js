import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SITE_URL, getPublicProduct } from '@/lib/publicData.server';
import OpenInShop from './OpenInShop';

/**
 * A product's own address: /shop/product/<id>.
 *
 * Shared links (Facebook, Messenger, Google) read this page without running
 * scripts, so it carries the product's own title, photo, price and
 * description. A shopper who opens it is taken straight to the product in the
 * shop, where the cart, options and reviews live.
 */

export const revalidate = 300;

const peso = (value) => `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const summary = (product) => {
  const text = String(product.description || '').replace(/\s+/g, ' ').trim();
  const lead = `${peso(product.price)}${product.shop ? ` from ${product.shop.business_name}` : ''} on CONNECT-Daet.`;
  return `${lead} ${text}`.slice(0, 200);
};

export async function generateMetadata({ params }) {
  const { id } = await params;
  const product = await getPublicProduct(id);
  if (!product) {
    return { title: 'Product not found | CONNECT-Daet.ph' };
  }

  const title = `${product.name} – ${peso(product.price)} | CONNECT-Daet.ph`;
  const description = summary(product);
  const url = `${SITE_URL}/shop/product/${product.id}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      type: 'website',
      locale: 'en_PH',
      siteName: 'CONNECT-Daet.ph',
      images: product.image_url ? [{ url: product.image_url, alt: product.name }] : undefined,
    },
    twitter: {
      card: product.image_url ? 'summary_large_image' : 'summary',
      title,
      description,
      images: product.image_url ? [product.image_url] : undefined,
    },
  };
}

export default async function ProductPage({ params }) {
  const { id } = await params;
  const product = await getPublicProduct(id);
  if (!product) notFound();

  const shopLink = `/shop?product=${product.id}`;
  const onSale = Number(product.original_price) > Number(product.price);
  // Structured data so search engines can show the price and availability.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description || undefined,
    image: product.image_url || undefined,
    brand: product.shop ? { '@type': 'Brand', name: product.shop.business_name } : undefined,
    offers: {
      '@type': 'Offer',
      priceCurrency: 'PHP',
      price: Number(product.price).toFixed(2),
      availability: Number(product.stock) > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url: `${SITE_URL}/shop/product/${product.id}`,
    },
  };

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <OpenInShop href={shopLink} />
      <article className="mx-auto max-w-xl overflow-hidden rounded-2xl bg-white shadow-sm">
        {product.image_url && (
          // A plain image keeps this page light; it is mostly read by link previews.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.image_url} alt={product.name} className="aspect-[4/3] w-full object-cover" />
        )}
        <div className="p-6">
          <h1 className="text-2xl font-bold text-gray-900">{product.name}</h1>
          {product.shop && <p className="mt-1 text-sm text-gray-600">Sold by {product.shop.business_name}</p>}
          <p className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-blue-600">{peso(product.price)}</span>
            {onSale && <span className="text-gray-400 line-through">{peso(product.original_price)}</span>}
          </p>
          {product.description && <p className="mt-4 whitespace-pre-line text-sm text-gray-700">{product.description}</p>}
          <Link
            href={shopLink}
            className="mt-6 inline-flex min-h-[44px] items-center rounded-lg bg-blue-600 px-6 font-semibold text-white hover:bg-blue-700"
          >
            View in the shop
          </Link>
        </div>
      </article>
    </main>
  );
}
