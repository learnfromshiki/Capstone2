'use client';

/**
 * Read-only star display for a 1-5 rating. Interactive star picking for the
 * review form lives in ProductDetailsModal, where each star is a button.
 */
export default function StarRating({ rating = 0, size = 'sm' }) {
  const value = Number(rating) || 0;
  const filled = Math.round(value);
  const dimension = size === 'lg' ? 'w-6 h-6' : 'w-4 h-4';

  return (
    <span
      className="inline-flex items-center gap-0.5"
      aria-label={`${value.toFixed(1)} out of 5 stars`}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <svg
          key={star}
          className={`${dimension} ${star <= filled ? 'text-yellow-500' : 'text-gray-300'}`}
          fill="currentColor"
          viewBox="0 0 20 20"
          aria-hidden="true"
        >
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
    </span>
  );
}
