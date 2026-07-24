import { HTMLAttributes } from 'react';

// The shared "section/card" surface (GitHub issue #231, Phase 22) —
// previously 11 call sites duplicated the identical flat-border string
// independently. A shadow needs a background distinct from the page's
// own to read as elevated, hence the explicit bg here. `as` lets callers
// keep `<section>` where it's a real page landmark (most call sites) vs.
// `<div>` for a one-off item card (e.g. a single review or queue entry).
interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: 'div' | 'section';
}

export function Card({ as: Tag = 'div', className = '', ...props }: CardProps) {
  return (
    <Tag
      {...props}
      className={`rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900 ${className}`}
    />
  );
}
