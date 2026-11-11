'use client';

/**
 * A profile picture, falling back to the person's initials when they have not
 * uploaded one. Used in the dashboards, the headers and on reviews.
 */
const SIZES = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-12 w-12 text-base',
  lg: 'h-20 w-20 text-xl',
  xl: 'h-24 w-24 text-2xl',
};

export const initialsOf = (name, email) => {
  const source = (name || '').trim() || (email || '').split('@')[0] || '';
  const parts = source.split(/\s+/).filter(Boolean);

  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

export default function Avatar({ src, name, email, size = 'md', className = '' }) {
  const dimension = SIZES[size] || SIZES.md;

  if (src) {
    return (
      <img
        src={src}
        alt={name ? `${name}'s profile picture` : 'Profile picture'}
        className={`${dimension} flex-shrink-0 rounded-full object-cover ${className}`}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`${dimension} flex flex-shrink-0 items-center justify-center rounded-full bg-blue-100 font-bold text-blue-700 ${className}`}
    >
      {initialsOf(name, email)}
    </span>
  );
}
