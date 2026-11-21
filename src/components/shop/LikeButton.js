'use client';

/** The heart a shopper taps to save a product to their Likes. */
export default function LikeButton({ liked, onToggle, productName = 'this product', size = 'md', className = '' }) {
  const dimension = size === 'sm' ? 'h-9 w-9' : 'h-10 w-10';
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      aria-pressed={liked}
      aria-label={liked ? `Remove ${productName} from your likes` : `Add ${productName} to your likes`}
      title={liked ? 'Liked' : 'Like'}
      className={`${dimension} flex items-center justify-center rounded-full bg-white/95 shadow-md transition-transform hover:scale-110 ${className}`}
    >
      <svg
        className={`h-5 w-5 ${liked ? 'text-red-500' : 'text-gray-500'}`}
        viewBox="0 0 24 24"
        fill={liked ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
        />
      </svg>
    </button>
  );
}
