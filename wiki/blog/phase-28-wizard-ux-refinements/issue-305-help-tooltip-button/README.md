# Phase 28, Issue #305 — A Question-Mark Button for Every Trait Tooltip

*Part of Phase 28 — Wizard UX Refinements. Epic #280 reopened for this
and two related follow-ons. See `docs/ROADMAP.md` Phase 28.*

## Where the gap actually was

Recruiter trait ratings already had tooltips, from issue #286 —
one-sentence definitions shown via a native `title` attribute on a
dotted-underline label. Round trait ratings (difficulty, fluency,
clarity, focus, technicalDepth) had nothing at all. Asked directly why
that asymmetry existed, the honest answer was just that #286 only
ever touched the recruiter form; nobody had gone back to add the same
thing to the round form.

## Key concept: an affordance you have to already know about isn't one

The bigger issue, once looked at again, was #286's own tooltip design.
A dotted underline plus a native `title` attribute works, but it gives
no visual signal that hovering does anything beyond "this text looks
slightly different" — there's no universally-recognized "there's more
information here" cue. A small circular "?" button next to a label is
that cue; it's a pattern most people have already learned to associate
with "hover or click this for help," which a subtly-underlined word is
not.

## Key concept: state over CSS, for testability and keyboard access

The obvious first implementation is pure CSS `:hover` plus a
`title`/custom tooltip element. That's fragile for two reasons this
project cares about: it's not reliably driveable from RTL tests (jsdom
doesn't simulate real mouse hover the way a browser does), and it's
invisible to keyboard-only or touch users, who can't hover at all. The
new `HelpTooltip` component tracks its own open/closed state instead,
toggled by `onMouseEnter`/`onMouseLeave` **and** `onFocus`/`onBlur` on
the button itself — the same interaction reachable by mouse, keyboard
tab order, or touch (which triggers focus), and directly assertable in
a test via `userEvent.hover()`/`.tab()` without any special jsdom
hover-simulation workaround.

## System design approach

```tsx
<span className="relative inline-flex">
  <button aria-label={`${field} help`} onMouseEnter={...} onFocus={...}>?</button>
  {open && <span role="tooltip">{text}</span>}
</span>
```

Applied identically to every round trait (with new one-sentence
definitions matching the Phase 24 issue #247 field-redesign reasoning)
and every recruiter trait (replacing #286's underline pattern), so
both groups now look and behave the same way.

## What this enabled

Every rating trait in the wizard — round and recruiter alike — now
has a discoverable, keyboard-accessible explanation of what it's
actually asking, with one shared component doing the work instead of
two different patterns living side by side.
