# Phase 43, Issue #620 — Status Vocabulary Rollout

*Part of Phase 43 — Design System Refresh & Theming.
See `docs/ROADMAP.md` Phase 43 and `docs/DECISIONS.md` D100.*

## The gap this closed

`RoundRating`, `RecruiterRating`, and `OverallReview` all share the
same four-value status vocabulary — `pending` / `approved` / `rejected`
/ `flagged`. On `/me`, the page where a candidate actually sees the
state of their own submissions, all four rendered as plain colored
text:

```ts
const STATUS_CLASS: Record<string, string> = {
  pending: 'text-amber-700 dark:text-amber-400',
  approved: 'text-green-700 dark:text-green-400',
  rejected: 'text-red-700 dark:text-red-400',
  flagged: 'text-amber-700 dark:text-amber-400',
};
```

`pending` and `flagged` are the *identical* amber. A candidate looking
at their own review list had no way to tell "still waiting on a
moderator" from "flagged for fraud review" without reading the word
itself — the color carried no information between those two states at
all. This issue built a real status-pill component and put it
everywhere that vocabulary — or something close enough in spirit —
renders.

## Key concept: a tone-based API, not a hardcoded four-value one

```tsx
// src/components/StatusPill.tsx
export type PillTone = 'good' | 'warning' | 'serious' | 'critical';
const TONE_ICON: Record<PillTone, typeof Check> = {
  good: Check, warning: Clock, serious: Flag, critical: X,
};
export function StatusPill({ tone, children }: StatusPillProps) {
  const Icon = TONE_ICON[tone];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{
        backgroundColor: `color-mix(in oklab, var(--status-${tone}) 16%, transparent)`,
        color: `var(--status-${tone}-ink)`,
      }}
    >
      <Icon aria-hidden="true" className="h-3 w-3" />
      {children}
    </span>
  );
}
```

`StatusPill` takes a `tone`, not a status string — `ENTITY_STATUS_TONE`
(a small shared map in `src/lib/status.ts`) is what translates the
real four-value vocabulary into one of the four tones. That
indirection is what let `/admin/staff`'s Active/Deactivated state reuse
the exact same component with `tone="good"`/`"critical"` directly,
without inventing a second pill component or forcing a staff account's
binary active state to pretend it's part of the pending/approved/
rejected/flagged vocabulary it isn't actually part of.

## Key concept: text color is never the raw hue

Every tone's *text* color comes from a `-ink` CSS variable, never
`--status-warning`/`--status-serious`/etc. directly — the raw hexes
measure 1.79:1 and 2.57:1 against a light surface (documented in the
`dataviz` skill's own palette reference), which fails outright as text
color regardless of the icon+label pairing sitting next to it. The
raw hue stays reserved for fills and icon strokes, where that
contrast bar doesn't apply the same way.

## Key concept: give the negative case a positive counterpart

```tsx
// before: only the negative case had a label at all
{!account.isActive && <span className="text-xs text-gray-500">deactivated</span>}

// after
<StatusPill tone={account.isActive ? 'good' : 'critical'}>
  {account.isActive ? 'Active' : 'Deactivated'}
</StatusPill>
```

The old staff-accounts row only ever rendered a label for the
*deactivated* case — an active account had no visual confirmation of
its own state at all, just the absence of a warning. Both states now
get the same pill treatment, which is a small thing but matches the
same principle driving the whole issue: a status is either legible at
a glance or it isn't, and "no label" isn't a legible state.

## Verification

Full suite green (231/231, six new `StatusPill` tests covering label
rendering, all four tones' `-ink` text color, and the icon's
`aria-hidden` pairing). Real-browser check, both themes, via cookie
injection + route interception for `/me/submissions`: all four states
render distinctly and legibly — Pending and Flagged are now
unambiguous at a glance, the actual bug this issue exists to fix. The
`/admin/staff` usage is the identical component with a different
`tone`, already proven via `/me`'s screenshots and `StatusPill`'s own
unit tests; not independently screenshotted, since faking a staff
admin session is substantially more involved than the candidate
session cookie and this call site adds no new rendering logic worth
re-verifying.
