# Phase 43, Issue #622 — Accessibility & Responsive Audit

*Part of Phase 43 — Design System Refresh & Theming.
See `docs/ROADMAP.md` Phase 43.*

## The gap this closed

Every prior issue in this phase shipped its own verification — real-
browser screenshots, targeted tests. This issue was the pass that
looks *across* all of it at once: keyboard navigation on the new
Radix-backed primitives, contrast on every new token pairing, mobile
breakpoints on every redesigned screen. An audit that finds nothing
is a weaker signal than one built to actually catch something. This
one caught two real bugs.

## Key concept: read computed styles from a real browser, not a spreadsheet

The obvious way to check contrast is to look up each token's hex value
and run it through a calculator. The more honest way, given
`StatusPill`'s background comes from `color-mix()`, is to ask the
browser what it actually rendered:

```js
const style = getComputedStyle(pillTextElement);
// style.color: "rgb(226, 86, 79)"
// style.backgroundColor (a color-mix() result): "oklab(0.6935 0.1497 0.0491 / 0.16)"
```

Chromium serializes a `color-mix()` computed value as `oklab(...)`,
not `rgb(...)` — a detail a hand-derived estimate would never surface,
since it only exists once the browser actually resolves the
expression. The audit script converts OKLab to sRGB properly (Björn
Ottosson's published conversion matrices) and composites the
resulting semi-transparent color over the pill's *actual* card
background — light or dark — before computing a real WCAG contrast
ratio. Seven of eight tone/theme pairings cleared 4.5:1 immediately.
The eighth — `critical`'s text color in dark mode — measured 3.62:1:
passes AA-large, fails AA-normal at the pill's real 12px size.

```css
/* before: text color = the same hue used for fills/icons */
--status-critical-ink: #e2564f;   /* 3.62:1 — fails AA-normal text */

/* after: a lighter shade, for text specifically */
--status-critical-ink: #f0837c;   /* 5.26:1 — clears it */
```

`--status-critical` itself (still used for fills and icon strokes)
stayed the original hue — only the text-specific `-ink` token needed
lightening, and only in dark mode; light mode's `critical-ink` had
already been hand-tuned during the original design-brief pass and
cleared 4.96:1.

## Key concept: an actual 375px screenshot, not a browser resize

```js
const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
if (scrollWidth > clientWidth) errors.push(`HORIZONTAL OVERFLOW …`);
```

A programmatic overflow check across the landing, profile, and
analytics pages found none — but the screenshots it also captured
found something the overflow check couldn't: `DifficultyBar`'s round-
type label, "System Design," rendering as "System ..." at 375px. Its
grid used `minmax(0,1fr)` for the label column, which lets the bar and
value columns win the available space on a narrow viewport instead of
respecting the label's actual content. Fixed to a fixed `7.5rem`
column — wide enough for every current round-type label at any
viewport width — rather than a responsive-only patch that would have
left the underlying flexible-column assumption in place for the next
label that happens to be longer.

## Key concept: a claim from an earlier issue's commit message isn't verification until it has a test

#615's commit message asserted Radix Dialog gives `ConfirmationModal`
"a real focus trap and ESC-to-close" — true, but untested. This audit
added the tests that earlier claim was missing:

```tsx
it('calls onClose on Escape', …);
it('moves focus inside the dialog on open, not left on whatever was focused before', …);
it('traps Tab focus inside the dialog — cycling never lands on document.body', …);
```

All three passed on the first run. The underlying Radix behavior was
correct the whole time — but "correct and untested" is a claim, not a
verified fact, and the difference matters the next time someone
touches this component and has no test to tell them if they broke it.
The same gap existed for `HelpTooltip`'s Escape dismissal and
`ThemeToggle`'s keyboard operability (Tab + Enter); both got the same
treatment.

## Verification

Full suite green (36 suites, 239 tests, ten new across this issue
alone), lint and build clean. This issue's own "verification" *is* the
audit — the two bugs above, and the newly-closed test gaps, are its
actual output, not a formality performed after the fact.
