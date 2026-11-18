'use client';

const TONES = {
  red: 'bg-red-500 text-white',
  amber: 'bg-amber-400 text-amber-950',
  blue: 'bg-blue-500 text-white',
};

/**
 * The little count next to a sidebar item, tab or icon.
 *
 * Nothing is drawn for 0. The number pops each time it changes (the key
 * restarts the animation), and a screen reader hears what it counts.
 *
 * @param {number} count
 * @param {'red'|'amber'|'blue'} [tone] - red: someone is waiting on you,
 *   amber: worth a look, blue: just information
 * @param {string} [label] - e.g. "orders to handle"
 * @param {'inline'|'plain'|'corner'} [placement] - pushed to the end of a
 *   sidebar row, right after a label, or on the corner of an icon
 */
export default function NavBadge({ count, tone = 'red', label = '', placement = 'inline', className = '' }) {
  const value = Number(count) || 0;
  if (value <= 0) return null;

  const position =
    placement === 'corner'
      ? 'absolute -right-0.5 -top-0.5 ring-2 ring-white'
      : placement === 'plain'
        ? ''
        : 'ml-auto';

  return (
    <span
      key={value}
      className={`nav-badge-pop inline-flex h-5 min-w-[20px] flex-shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-bold leading-none ${TONES[tone] || TONES.red} ${position} ${className}`}
      aria-label={label ? `${value} ${label}` : String(value)}
      title={label ? `${value} ${label}` : undefined}
    >
      {value > 99 ? '99+' : value}
    </span>
  );
}
