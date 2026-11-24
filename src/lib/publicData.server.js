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
  // revalidate 0 = always read fresh (no cached copy).
  const cache = revalidate === 0 ? { cache: 'no-store' } : { next: { revalidate } };
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      ...cache,
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

/**
 * Category slugs that have at least one listed product from a public shop,
 * or null when the store could not be read (callers then keep their default).
 */
export const listCategoriesInUse = async () => {
  const [products, sellers] = await Promise.all([
    rest('shop_products?available=eq.true&select=category,seller_id&limit=5000', { revalidate: 0 }),
    rest('shop_sellers?is_approved=eq.true&is_active=eq.true&select=id&limit=5000', { revalidate: 0 }),
  ]);
  if (!Array.isArray(products)) return null;
  const publicShops = new Set(Array.isArray(sellers) ? sellers.map((s) => s.id) : []);
  const used = new Set();
  products.forEach((p) => {
    if (p.category && (!p.seller_id || publicShops.has(p.seller_id))) used.add(p.category);
  });
  return used;
};

/** Active categories from shop_categories (name, slug, icon), or null. */
export const listPublicCategories = async () => {
  const rows = await rest('shop_categories?is_active=eq.true&select=name,slug,icon,display_order&order=display_order.asc', {
    revalidate: 0,
  });
  return Array.isArray(rows) ? rows : null;
};
