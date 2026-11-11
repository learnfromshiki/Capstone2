'use client';

import { checkPassword } from '@/lib/passwordPolicy';

/**
 * Live checklist under a password box. Every rule is listed from the start so
 * people know what is expected before they start typing, and each one ticks
 * green as soon as it is met.
 */
export default function PasswordRequirements({ value, className = '' }) {
  const results = checkPassword(value);

  return (
    <ul className={`mt-2 space-y-1 ${className}`} aria-live="polite">
      {results.map((rule) => (
        <li
          key={rule.id}
          className={`flex items-center gap-2 text-xs ${rule.met ? 'text-green-700' : 'text-gray-500'}`}
        >
          <span
            aria-hidden="true"
            className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
              rule.met ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'
            }`}
          >
            {rule.met ? '✓' : '•'}
          </span>
          <span>{rule.label}</span>
          <span className="sr-only">{rule.met ? '(met)' : '(not met yet)'}</span>
        </li>
      ))}
    </ul>
  );
}
