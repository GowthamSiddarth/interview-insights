# Phase 4, Issue #10 — Analytics Dashboard UI

*Part of Phase 4 — Analytics. See `docs/ROADMAP.md` Phase 4, CLAUDE.md hard
constraint #3.*

## Why this came first

Issue #9 made shrinkage-scored analytics available over HTTP, but nothing
consumed them yet. Issue #10 is the last item in Phase 4 — a dashboard
page that renders issue #9's response, and specifically renders it in a
way that never violates the one rule this whole phase exists to protect:
never show a raw, misleadingly-precise number when there isn't enough
data behind it.

## Key concepts

- **Centralize the null-handling rule in exactly one component.** Issue
  #9's response shape has eleven separate scores across three sections
  (5 round-type behavioral metrics, 4 recruiter metrics, 2 overall
  metrics) — implementing "if null, show 'not enough reviews yet';
  otherwise show the number and the sample size" inline, eleven separate
  times, would be eleven separate chances to get it slightly wrong (or
  for a future edit to fix it in ten places and miss the eleventh). A
  single `ScoreDisplay` component, used for every one of the eleven,
  makes the rule impossible to violate by accident anywhere it's used.
- **The reusable UI lesson: a null-safe display component isn't about
  avoiding a crash, it's about avoiding a misleading truth.** `value ===
  null ? 'Not enough reviews yet' : value.toFixed(2)` doesn't just
  prevent `null.toFixed is not a function` from crashing the page — a
  naive `{value ?? 0}` wouldn't crash either, but it would render `0`,
  which reads as "this company scored zero" to a user, a completely
  different and false claim from "we don't have enough data to say."
  Treating `null` as its own distinct rendering case, not as a fallback
  value to paper over, is the actual lesson here — directly reusable
  anywhere a UI shows a computed statistic that can legitimately be
  "unknown" rather than any particular number.
- **Show the sample size even when the score itself is hidden.**
  `ScoreDisplay` always renders `{sampleSize} review(s)` underneath,
  whether or not the score itself is null — this is issue #9's API-level
  transparency principle carried all the way through to the pixel level,
  not lost somewhere in the rendering layer.

## Core technologies

- **A small, prop-driven React component** (`ScoreDisplay`), taking
  `label`, `value: number | null`, `sampleSize`, and an optional
  `suffix` (for percentage metrics like "would recommend") — no internal
  state, purely a function of its props, which is exactly what makes it
  trivially reusable across eleven different call sites.
- **Next.js dynamic route params via `use()`** — `params: Promise<{
  companyId: string }>` unwrapped with React's `use()` hook, the current
  Next.js App Router pattern for reading a dynamic segment in a client
  component.
- **`<dl>`/`<dt>`/`<dd>` semantic HTML** for each score — a description
  list is the semantically correct element for a label/value pair, which
  matters for accessibility (screen readers announce the label-value
  relationship correctly) even though it's easy to reach for a generic
  `<div>` instead.

## System design approach

`ScoreDisplay` is the entire null-handling contract for this phase,
expressed as one small component:

```tsx
export function ScoreDisplay({ label, value, sampleSize, suffix = '' }: {
  label: string;
  value: number | null;
  sampleSize: number;
  suffix?: string;
}) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-gray-500">{label}</dt>
      {value === null ? (
        <dd className="text-sm text-gray-500 italic">Not enough reviews yet</dd>
      ) : (
        <dd className="text-lg font-semibold">{value.toFixed(2)}{suffix}</dd>
      )}
      <span className="text-xs text-gray-400">
        {sampleSize} {sampleSize === 1 ? 'review' : 'reviews'}
      </span>
    </div>
  );
}
```

Three details worth internalizing, each individually small but each a
real, easy-to-miss mistake in a naive first pass at this kind of
component:

- **`value === null`, not `!value`.** A falsy check would also treat a
  real score of `0` as "not enough data" — never true for this
  particular formula (a shrinkage score is always a weighted average of
  two positive numbers, so it can't legitimately be exactly zero), but
  the explicit `=== null` check is what makes that safe rather than
  coincidental, and is the correct habit regardless of whether `0` is
  reachable in this specific case.
- **Singular/plural handling** (`sampleSize === 1 ? 'review' : 'reviews'`)
  — a small thing, but "1 reviews" reads as sloppy in a way that
  undermines trust in a page whose entire purpose is presenting
  statistics carefully.
- **The component takes primitives, not the whole API response shape.**
  `ScoreDisplay` doesn't know anything about `CompanyAnalytics` or which
  section it's rendering into — the page passes it exactly the two
  numbers it needs. This is what makes it equally reusable for a
  round-type metric, a recruiter metric, and an overall metric, despite
  those three living in structurally different parts of the API
  response.

The page itself (`companies/[companyId]/analytics/page.tsx`) is a thin
composition of three sections — overall, per-round-type, recruiter —
each independently gated on whether that section of the response has any
data at all:

```tsx
{analytics.roundTypes.length === 0 ? (
  <p className="text-sm text-gray-500 italic">Not enough reviews yet</p>
) : (
  analytics.roundTypes.map((rt) => (
    <ScoreDisplay label="Difficulty" value={rt.scores.difficulty} sampleSize={rt.sampleSize} />
    // ...4 more metrics, same round type's sampleSize...
  ))
)}
```

This section-level check (`roundTypes.length === 0`) and the metric-level
check inside `ScoreDisplay` (`value === null`) are answering two
different questions: "has this company ever been rated on any round
type at all" versus "is this specific metric, for a round type the
company *has* been rated on, above the shrinkage floor." Both are real,
distinct absent-data cases from issue #9's response shape, and the
dashboard renders each with its own, separately-correct empty state.

## Step-by-step: what actually got built

1. **Built `ScoreDisplay`** as a standalone, reusable component, before
   the dashboard page itself, driven by the shape of issue #9's already-
   finalized API response.
2. **Wrote 3 component tests** (`score-display.spec.tsx`) covering the
   `null` branch, the non-null branch, and the singular-vs-plural
   "review"/"reviews" branch — cheap, fast tests for a component with no
   network dependency at all.
3. **Built the dashboard page**, fetching issue #9's endpoint on mount
   and rendering the three sections (overall / by round type / recruiter),
   each using `ScoreDisplay` for every individual metric.
4. **Added a "View analytics dashboard" link** from the Phase 2 wizard
   homepage, appearing once a company is selected — making the dashboard
   actually reachable from the app's existing navigation rather than
   requiring a hand-typed URL.
5. **Manually verified in a real browser (Playwright)** — the same
   discipline established in Phase 2.3, now applied to a page with
   actual conditional statistical rendering rather than a linear wizard:
   seeded a company with a deliberate mix (one round type comfortably
   above the shrinkage floor, one below it, plus an under-the-floor
   recruiter and overall review), then confirmed the dashboard rendered
   *real numbers* for the one scored slice and "Not enough reviews yet"
   in exactly the 11 other places expected (5 behavioral metrics + 4
   recruiter + 2 overall) — an exact count, not an approximate "looks
   about right" check — with zero console errors. Also confirmed the
   wizard's dashboard link actually navigates to the correct company.

## What this enabled

Phase 4 closed out fully once this issue merged — the whole path from
raw approved ratings (Phase 2-3) through aggregation (issue #7),
statistically sound scoring (issue #8), a public API (issue #9), to a
rendered dashboard (this issue) was complete and verified end to end.
The `ScoreDisplay` component's null-handling pattern is also the direct
template Phase 5's `EmptyState` component followed one phase later — a
different, cheaper problem (an empty search result list, not a
statistical floor), but the same underlying principle: absence of data
is a distinct, first-class state to render deliberately, never a
fallback value to paper over.
