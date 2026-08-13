# Phase 43, Issue #619 — Analytics Dashboard Redesign: Stat Tiles + Magnitude Bar Chart

*Part of Phase 43 — Design System Refresh & Theming.
See `docs/ROADMAP.md` Phase 43 and `docs/DECISIONS.md` D100.*

## The gap this closed

The analytics page was a `dl` grid of `ScoreDisplay` pairs, repeated
three times (overall, per round type, recruiter) — every number
formatted identically regardless of whether it was worth comparing to
its neighbors. This issue replaced the grid with `StatTile` and gave
"By round type" a real magnitude chart, using the `--chart-seq-1..5`
tokens #612 defined and left unused for exactly this.

## Key concept: pick the form before picking the color

Round-type difficulty is a magnitude comparison across categories that
all measure the *same* metric — not four different series competing
for attention. The `dataviz` skill's form heuristic is explicit about
this: magnitude comparison gets one hue, lightness carrying the value;
identity/categorical data gets multiple hues. Round type is a category
*label* here, not a category *series*.

```tsx
function seqStepFor(value: number, max: number): number {
  const fraction = Math.max(0, Math.min(1, value / max));
  return Math.min(5, Math.max(1, Math.ceil(fraction * 5)));
}
// …
style={{
  width: `${(value / max) * 100}%`,
  backgroundColor: `var(--chart-seq-${seqStepFor(value, max)})`,
}}
```

One hue, five lightness steps, each bar's own fill intensity keyed to
its own value — a company with a 4.1-difficulty System Design round
and a 1.5-difficulty Behavioral round shows that gap as visibly
different shades of the same teal, not four unrelated colors
competing for the eye.

## Key concept: a real bug the build caught, not a review

```
Type 'null' is not assignable to type 'number'.
<DifficultyBar key={rt.roundType} roundType={rt.roundType} value={rt.scores.difficulty} />
```

`DifficultyBar` was first written with `value: number`. `npm run
build` disagreed: `RoundTypeAnalytics.scores.difficulty` is `number |
null` — a round type having enough *samples* overall doesn't guarantee
every individual metric clears the shrinkage floor on its own
(CLAUDE.md hard constraint #3). A round type with `focus: null` was
already exercised in this file's own test mocks; difficulty being
nullable too just hadn't come up yet. Fixed to render an empty track
and an em-dash instead of a hidden zero-width bar — the same rule
`ScoreRing`/`StatTile` already apply — and locked in with a regression
test using a round type whose difficulty is explicitly `null` while
its other metrics aren't.

## Key concept: keep the reasoning to two decisions per hunch

The round-type section ended up split into two loops over the same
data — a difficulty bar-chart block, then a per-round-type grid of
fluency/clarity/focus tiles — rather than one combined block per round
type. That's deliberate: difficulty is the one metric worth comparing
*across* round types side by side; fluency/clarity/focus are
interviewer traits, not round properties, and the meaningful grouping
for them is "per round type," not "across round types." Two visual
groupings for two different comparison jobs, documented inline so the
split doesn't read as an accident of refactoring.

## Verification

Full suite green (225/225): a direct regression test for the null-
difficulty path, plus `StatTile`'s own six tests (2-decimal
formatting, the suffix path, singular "review," and the null floor
never rendering a number — a bug in that last test's own regex,
`/^\d/`, matching the sample-size text "2 reviews" instead of just a
score, was caught and fixed before it could hide a real regression).
One existing assertion updated for the same reason as #618: round-type
difficulty moved from `'3.50'` to `'3.5'`, a chart label's one-decimal
format, not ScoreDisplay/StatTile's two. Real-browser check, both
themes: the sequential ramp reads correctly at a glance (a 4.1
System Design bar visibly darker than a 1.5 Behavioral bar), null
Focus shows "Not enough reviews yet," no console errors.
