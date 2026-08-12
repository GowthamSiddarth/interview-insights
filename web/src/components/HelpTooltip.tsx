'use client';

import * as Tooltip from '@radix-ui/react-tooltip';

// GitHub issue #305 (Phase 28) — a small "?" affordance next to a rating
// trait's label, showing a one-sentence definition on hover/focus.
//
// Built on Radix's Tooltip primitive (GitHub issue #615) instead of a
// hand-rolled onMouseEnter/onFocus useState toggle — Radix supplies the
// aria-describedby wiring linking the trigger to its content (the old
// version had a bare `role="tooltip"` with no such link), ESC-to-close,
// and correct positioning, on top of the same hover/focus-shows,
// blur/unhover-hides behavior the hand-rolled version had. Requires a
// single shared `Tooltip.Provider` up the tree — see layout.tsx.
interface HelpTooltipProps {
  label: string;
  text: string;
}

export function HelpTooltip({ label, text }: HelpTooltipProps) {
  return (
    // delayDuration set directly on Root (not just the shared Provider
    // in layout.tsx) so this stays fast and deterministic even when
    // rendered standalone, e.g. in a test with no Provider ancestor.
    // disableHoverableContent matches the original hand-rolled
    // behavior exactly (mouseleave on the button hid it immediately,
    // no grace period for moving the pointer into the tooltip itself —
    // it's a one-line definition, not something anyone needs to
    // interact with).
    <Tooltip.Root delayDuration={150} disableHoverableContent>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          className="flex h-4 w-4 items-center justify-center rounded-full border border-gray-400 text-[10px] leading-none text-gray-500 transition-colors hover:border-indigo-500 hover:text-indigo-600 dark:border-gray-500 dark:text-gray-400 dark:hover:border-indigo-400 dark:hover:text-indigo-400"
        >
          ?
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          sideOffset={4}
          className="z-10 w-48 rounded-md bg-gray-900 px-2 py-1 text-xs font-normal normal-case text-white shadow-lg dark:bg-gray-700"
        >
          {text}
          <Tooltip.Arrow className="fill-gray-900 dark:fill-gray-700" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
