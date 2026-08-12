import { Inbox } from 'lucide-react';

// A search that returns zero results must say so explicitly — never a
// silently empty list indistinguishable from "still loading" or "haven't
// searched yet" (docs/ROADMAP.md Phase 5 issue #23 scope).
//
// One generic icon across all 12 call sites (search no-match, empty
// drafts, empty moderation queue, no staff accounts, ...) rather than a
// bespoke icon per context (GitHub issue #614) — that level of nuance
// belongs to each screen's own redesign issue, not this one.
export function EmptyState({ message }: { message: string }) {
  return (
    <p className="flex items-center gap-1.5 text-sm text-gray-500 italic">
      <Inbox aria-hidden="true" className="h-4 w-4 shrink-0" />
      {message}
    </p>
  );
}
