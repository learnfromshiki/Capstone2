/**
 * Public store data read on the server, for product pages, link previews and
 * the sitemap. Uses the public (anon) key, so it sees exactly what a signed-out
 * shopper sees: row level security applies as usual.
 */

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://capstone2-tawny-iota.vercel.app').replace(/\/$/, '');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const rest = async (path, { revalidate = 300 } = {}) => {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      next: { revalidate },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.warn('Could not read store data:', error?.message || error);
    return null;
  }
};

/** One listed product with its shop, or null. */
export const getPublicProduct = async (id) => {
  if (!UUID.test(String(id || ''))) return null;
  const rows = await rest(
    `shop_products?id=eq.${id}&available=eq.true&select=id,name,description,price,original_price,stock,image_url,category,seller_id,updated_at`
  );
  const product = Array.isArray(rows) ? rows[0] : null;
  if (!product) return null;

  let shop = null;
  if (product.seller_id) {
    const sellers = await rest(`shop_sellers?id=eq.${product.seller_id}&select=id,business_name`);
    shop = Array.isArray(sellers) ? sellers[0] || null : null;
    // A shop that is not public (pending, rejected, suspended) hides its products.
    if (!shop) return null;
  }

  return { ...product, shop };
};

/** Every listed product, for the sitemap. */
export const listPublicProducts = async () => {
  const rows = await rest('shop_products?available=eq.true&select=id,updated_at&order=updated_at.desc&limit=5000', {
    revalidate: 3600,
  });
  return Array.isArray(rows) ? rows : [];
};
