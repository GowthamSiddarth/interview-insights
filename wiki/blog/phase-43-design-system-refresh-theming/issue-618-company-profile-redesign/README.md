# Phase 43, Issue #618 — Company Profile Redesign: Hero Header, Score Rings, Review Cards

*Part of Phase 43 — Design System Refresh & Theming.
See `docs/ROADMAP.md` Phase 43.*

## The gap this closed

The company profile page's header was a plain `h1`/`p` stack, and its
"Overall experience" section was a `dl` grid of two `ScoreDisplay`
pairs — functional, but visually indistinguishable from a form. This
issue built a real hero band and a new score visualization for the
handful of numbers this page foregrounds, without touching
`ScoreDisplay` itself.

## Key concept: a new component instead of modifying the shared one

```tsx
// src/components/ScoreRing.tsx — NOT a ScoreDisplay rewrite
const RADIUS = 26;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
export function ScoreRing({ label, value, sampleSize, max = 5, suffix = '' }: ScoreRingProps) {
  const fraction = value === null ? 0 : Math.max(0, Math.min(1, value / max));
  const dashoffset = CIRCUMFERENCE * (1 - fraction);
  // …renders an SVG ring, filled only when value !== null
}
```

`ScoreDisplay` also renders on the analytics page, as part of a dense
grid of many scores at once (#619's own territory) — restyling it here
would mean either a half-finished change that #619 has to finish, or
a `ScoreRing`-shaped grid of many small rings that never fit the
brief's actual analytics-page vision. Building a dedicated component
for the one or two scores a profile *header* foregrounds keeps each
page's redesign scoped to what that page actually needs, and leaves
`ScoreDisplay`'s dense-grid role untouched until #619 gets there on
its own terms.

## Key concept: `<button onClick>` isn't the same as `<a href>`

```tsx
// src/components/Button.tsx
type ButtonProps = ButtonAsButtonProps | ButtonAsLinkProps;
export function Button({ className = '', variant = 'primary', href, ...props }: ButtonProps) {
  const classes = `rounded-md px-3 py-1 text-sm text-white … ${VARIANT_CLASSES[variant]} ${className}`;
  if (href) {
    return <Link href={href} className={classes} {...(props as AnchorHTMLAttributes<HTMLAnchorElement>)} />;
  }
  return <button {...(props as ButtonHTMLAttributes<HTMLButtonElement>)} className={classes} />;
}
```

Promoting "Write a review" from a text link to a prominent
button-styled CTA raised a real question: build it as a `<button
onClick={() => router.push(...)}>`, or extend `Button` to render a
real `<Link>` when given an `href`? The button-with-onClick route
would have looked identical but quietly dropped right-click/open-in-
new-tab/status-bar-preview — real regressions for what is, underneath
the styling, still a navigation action. The discriminated-union
`href`/no-`href` type keeps both call shapes type-safe: pass `href`
and TypeScript expects anchor props; don't, and it expects button
props.

## Key concept: nullable data doesn't stop at the field you're looking at

Round type Chip and review card polish aside, the one place this
issue's own scope got smaller rather than bigger: the design brief's
mockup showed a four-tab layout (Overview / Round ratings / Recruiter
experience / All reviews). Checking what data this page actually
fetches settled it — Round ratings and Recruiter experience live only
on `/analytics`, not here. Building tabs for content this page doesn't
have would be fabricated structure, not a design decision, so the
page kept its real two-section shape (Overall experience, Reviews) and
just got a visual pass.

## Verification

Full suite green (220/220): four new `Button` tests (href renders a
link not a button, still applies its variant), six new `ScoreRing`
tests (value/label/sample-size rendering, the singular "1 review"
case, the null floor never rendering a number, and ring math verified
via `stroke-dashoffset` for both a 5-point and a percentage score).
One existing assertion updated deliberately, not accidentally broken:
the profile page's aggregate-score test moved from `'4.20'` to
`'4.2'`, since `ScoreRing` formats to one decimal (a hero number) where
`ScoreDisplay` used two (a dense grid) — a real, intentional
divergence, not a regression papered over. Real-browser check, both
themes, via Playwright route interception (the by-slug/analytics/
reviews endpoints all need the still-blocked local API): hero band,
score rings, round-type chip, and the chevron-rotating expand/collapse
all render correctly.
