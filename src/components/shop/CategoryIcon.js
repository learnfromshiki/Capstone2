/**
 * A category's icon. shop_categories.icon holds either an emoji or the URL of
 * a photo a seller uploaded, so this shows the right one of the two.
 */
export const isImageIcon = (icon) => /^(https?:|blob:|data:image\/)/i.test(String(icon || ''));

export default function CategoryIcon({ icon, fallback = '📦', className = 'h-5 w-5' }) {
  const value = icon || fallback;
  if (isImageIcon(value)) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={value} alt="" className={`inline-block rounded-md object-cover ${className}`} />
    );
  }
  return <>{value}</>;
}

/** Text for places that cannot show a picture, such as a <select> option. */
export const categoryIconText = (icon) => (isImageIcon(icon) ? '' : icon || '');
