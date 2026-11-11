/**
 * Product options are the choices a seller offers on a product - colour, size,
 * flavour and so on. They are stored on shop_products.options as
 *   [{ "name": "Colour", "values": ["Red", "Blue"] }]
 * and the buyer's pick travels with the cart line and the order item as
 *   { "Colour": "Red" }
 */

/** Always return a clean array, whatever the database holds. */
export const readOptions = (product) => {
  const raw = product?.options;
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((group) => group && typeof group.name === 'string' && group.name.trim())
    .map((group) => ({
      name: group.name.trim(),
      values: Array.isArray(group.values)
        ? group.values.map((value) => String(value).trim()).filter(Boolean)
        : [],
    }))
    .filter((group) => group.values.length > 0);
};

export const hasOptions = (product) => readOptions(product).length > 0;

/** The groups still waiting for a choice. */
export const missingChoices = (product, selected = {}) =>
  readOptions(product)
    .filter((group) => !selected?.[group.name])
    .map((group) => group.name);

/** "Colour: Red · Size: M" for display on cards, carts and orders. */
export const describeSelection = (selected) => {
  if (!selected || typeof selected !== 'object') return '';
  return Object.entries(selected)
    .filter(([, value]) => value)
    .map(([name, value]) => `${name}: ${value}`)
    .join(' · ');
};

/**
 * Two cart lines are the same line only when they are the same product AND the
 * same choices, so a red one and a blue one are counted separately.
 */
export const cartLineId = (productId, selected) => {
  const signature = Object.entries(selected || {})
    .filter(([, value]) => value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}=${value}`)
    .join('|');

  return signature ? `${productId}::${signature}` : String(productId);
};

/** The product id behind a cart line id. */
export const productIdFromLine = (lineId) => String(lineId || '').split('::')[0];
