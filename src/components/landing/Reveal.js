'use client';

import { useEffect, useRef } from 'react';

/**
 * Fades its children in when they scroll into view.
 *
 *   <Reveal>...</Reveal>                       rises up
 *   <Reveal variant="left" delay={150}>...     slides in from the left after 150ms
 *
 * Variants: up (default), left, right, zoom. Content is visible without
 * JavaScript-driven motion for anyone who prefers reduced motion (see globals.css).
 */
export default function Reveal({ as: Tag = 'div', variant = 'up', delay = 0, className = '', children, ...rest }) {
  const ref = useRef(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;

    if (typeof IntersectionObserver === 'undefined') {
      node.classList.add('is-visible');
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const variantClass = variant === 'up' ? '' : `reveal-${variant}`;

  return (
    <Tag
      ref={ref}
      className={`reveal ${variantClass} ${className}`}
      style={{ '--reveal-delay': `${delay}ms` }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
