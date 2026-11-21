'use client';

import Image from 'next/image';

/**
 * The app's image tag. Photos from our Supabase storage go through Next.js
 * image optimization (resized and compressed for the screen, so a 4 MB phone
 * photo is not sent to a 64px thumbnail). Anything else is shown as given:
 * upload previews (blob:/data: URLs) and outside links cannot be optimized.
 *
 * Sizing stays with the className, as with a plain <img>; width/height only
 * pick the resolutions to generate, so pass a small width for thumbnails.
 */
const SUPABASE_HOST = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '').host;
  } catch (error) {
    return '';
  }
})();

const canOptimize = (src) => {
  if (typeof src !== 'string') return false;
  if (src.startsWith('/')) return !src.startsWith('//');
  try {
    const url = new URL(src);
    return url.protocol === 'https:' && Boolean(SUPABASE_HOST) && url.host === SUPABASE_HOST;
  } catch (error) {
    return false;
  }
};

export default function Img({ src, alt = '', width = 800, height, sizes, ...rest }) {
  // next/image refuses an empty src; keep the old plain-tag behaviour for it.
  if (!src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src || undefined} alt={alt} {...rest} />;
  }

  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height || width}
      sizes={sizes}
      unoptimized={!canOptimize(src)}
      {...rest}
    />
  );
}
