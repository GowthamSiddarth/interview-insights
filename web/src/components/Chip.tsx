import { HTMLAttributes } from 'react';

// Small pill badge — round-type tags, category labels (GitHub issue
// #618). Centralizes the bg-indigo-50/text-indigo-700 pairing already
// duplicated at its one prior call site (moderation/page.tsx's
// category badge, refactored onto this) before adding a second and
// third here and in #619/#620 — Phase 43's round-type and status
// chips share this same pill shape.
export function Chip({ className = '', ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      {...props}
      className={`rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 ${className}`}
    />
  );
}
