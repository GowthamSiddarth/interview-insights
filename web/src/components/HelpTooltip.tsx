'use client';

import { useState } from 'react';

// GitHub issue #305 (Phase 28) — a small "?" affordance next to a rating
// trait's label, showing a one-sentence definition on hover/focus. State
// (not pure CSS :hover) so it's keyboard/focus-accessible and reliably
// testable. Replaces the dotted-underline/title-attribute tooltip issue
// #286 originally used for recruiter traits, applied consistently to
// round traits too.
interface HelpTooltipProps {
  label: string;
  text: string;
}

export function HelpTooltip({ label, text }: HelpTooltipProps) {
  const [open, setOpen] = useState(false);

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="flex h-4 w-4 items-center justify-center rounded-full border border-gray-400 text-[10px] leading-none text-gray-500 transition-colors hover:border-indigo-500 hover:text-indigo-600 dark:border-gray-500 dark:text-gray-400 dark:hover:border-indigo-400 dark:hover:text-indigo-400"
      >
        ?
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute bottom-full left-1/2 z-10 mb-1 w-48 -translate-x-1/2 rounded-md bg-gray-900 px-2 py-1 text-xs font-normal normal-case text-white shadow-lg dark:bg-gray-700"
        >
          {text}
        </span>
      )}
    </span>
  );
}
