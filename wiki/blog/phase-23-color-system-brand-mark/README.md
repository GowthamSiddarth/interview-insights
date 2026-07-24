# Phase 23 — Color System & Brand Mark

*The two directions deliberately scoped out of Phase 22 as design-taste
calls rather than mechanical fixes. See `docs/ROADMAP.md` Phase 23 and
`docs/DECISIONS.md` D42.*

## Why these two were held back from Phase 22

Phase 22's own brainstorm produced five candidate directions:
typography, depth/surface, color, layout width, and a brand mark. Three
were mechanical — evaluate objectively, low risk, no real judgment call
involved (does the font load, does the shadow render, does the
container get wider). Two — expanding the color palette and adding a
real brand mark — are genuine design-taste decisions with no
objectively correct answer. Bundling a taste call into an otherwise
mechanical PR would have made the whole thing harder to evaluate on its
own terms, so they were named explicitly and deferred rather than
guessed at. This phase is that second pass.

## Key concept: "expand the color palette" doesn't have to mean "add a new color"

The instinctive reading of "expand the color palette" is picking a
second accent hue. Looking at the actual code first told a different
story: the app already had a real semantic color system in informal
use — indigo for primary actions, red for destructive ones, gray for
cancel/secondary, amber for the moderation queue's "flag" action — it
just wasn't *formalized*. Ten call sites across `me/page.tsx` and
`moderation/page.tsx` independently repeated the identical
`className="bg-red-600 hover:bg-red-700"` or `"bg-gray-600
hover:bg-gray-700"` override on top of the shared `Button` component,
the same kind of duplication `Card` was extracted to fix in Phase 22.

Introducing a new, arbitrary accent color with no clear purpose risks
looking exactly like what it is — arbitrary. Formalizing the colors
already doing real work in the product is the version of "expand the
palette" that's actually defensible, and it comes with a real
side-benefit: eliminating ten duplicated strings.

## System design approach: a `variant` prop, not more className surgery

```tsx
export type ButtonVariant = 'primary' | 'danger' | 'neutral' | 'warning';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-indigo-600 hover:bg-indigo-700 focus-visible:ring-indigo-500',
  danger: 'bg-red-600 hover:bg-red-700 focus-visible:ring-red-500',
  neutral: 'bg-gray-600 hover:bg-gray-700 focus-visible:ring-gray-500',
  warning: 'bg-amber-600 hover:bg-amber-700 focus-visible:ring-amber-500',
};

export function Button({ className = '', variant = 'primary', ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={`rounded-md px-3 py-1 text-sm text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900 ${VARIANT_CLASSES[variant]} ${className}`}
    />
  );
}
```

Every call site's `className="bg-red-600 hover:bg-red-700"` became
`variant="danger"`; `"bg-gray-600 hover:bg-gray-700"` became
`variant="neutral"`; the single `bg-amber-600` "Flag" button in the
moderation queue became `variant="warning"`. `button.spec.tsx`'s
existing assertion (`button.className` contains `bg-indigo-600` for the
default, unset variant) kept passing unchanged — `primary` is the
default and its class list includes exactly that string.

## Key concept: focus rings are accessibility, not decoration

Alongside the variant work, `Button` and every repeated text-input class
string across the app gained `focus`/`focus-visible` ring styling
(`focus-visible:ring-2 focus-visible:ring-offset-2` on buttons,
`focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500` on
inputs). Before this, keyboard navigation gave no visible indication of
which control had focus — a real, if easy to miss, gap. This is the
kind of thing that's simple to skip in the initial "flat borders,
default Tailwind" state (Phase 22's own opening description) and easy
to justify adding once the rest of the depth/surface work was already
in motion.

## Key concept: a brand mark without an external asset

```tsx
export function BrandMark({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect width="24" height="24" rx="6" className="fill-indigo-600" />
      <path
        d="M12 5.5l1.9 3.85 4.25.62-3.08 3 .73 4.23L12 15.15l-3.8 2.05.73-4.23-3.08-3 4.25-.62L12 5.5z"
        className="fill-white"
      />
    </svg>
  );
}
```

A rounded indigo badge with a star — the star ties directly into the
product's core concept (rating interview experiences), and reusing the
already-established indigo accent means the mark doesn't introduce yet
another color decision on top of everything else in this phase. It's
inline SVG, not an image file: no new asset to host, no external
request, the same self-contained philosophy `next/font/google` already
established for typography in Phase 22 (fetched once at build time, not
requested from the browser at runtime).

The same shape, as static markup, became `web/src/app/icon.svg` —
Next.js's App Router auto-detects this exact filename and serves it as
the site favicon with zero metadata configuration. One visual design,
two places it shows up, no duplicated decision-making.

## Step-by-step: what actually got built and verified

1. Grepped every `className="bg-red-600 hover:bg-red-700"` and
   `"bg-gray-600 hover:bg-gray-700"` occurrence across the app (10
   total, `me/page.tsx` and `moderation/page.tsx`) plus the one
   `bg-amber-600` flag button, confirming the full scope before writing
   the `Button` variant API.
2. Added the `variant` prop and `VARIANT_CLASSES` map to `Button.tsx`;
   replaced every matching call site with the corresponding `variant=`
   prop.
3. Added focus-ring classes to `Button` and swept every repeated
   text-input class string (page.tsx, login pages, search, moderation,
   me) to add matching `focus:` styling.
4. Built `BrandMark.tsx` and wired it into `NavBar` beside the
   wordmark; created the matching `web/src/app/icon.svg`.
5. Filed Phase 23's milestone, epic (#235), and two issues (#236
   feature, #237 this blog) before writing any code, per the
   established "plan a phase before implementing" convention.
6. Full web test suite (65 tests) — `button.spec.tsx`'s default-variant
   assertion and `nav-bar.spec.tsx`'s accessible-name assertion (the
   `aria-hidden` SVG doesn't affect the link's computed accessible
   name) both passed unchanged. Lint and build clean; the build output
   confirmed a new `/icon.svg` static route.
7. Rebuilt and rolled out the real `web` image against the live `kind`
   cluster. Verified live: `curl`'d `/icon.svg` directly (200,
   `image/svg+xml`), confirmed the mark renders in the nav bar via a
   real headless-browser pass, confirmed a focused search input shows a
   non-`none` box-shadow (the focus ring), logged in via a real
   magic-link and confirmed the "Delete my account" button computes to
   the actual red (`rgb(220, 38, 38)`, Tailwind's `red-600`) rather than
   the old ad hoc override — zero console errors, plus a screenshot
   confirming the mark reads cleanly next to the wordmark at normal
   size.

## What this enabled

The two remaining brainstorm items closed out without inventing new,
unjustified visual decisions — the color work made an already-real
system explicit and reusable instead of adding a new hue, and the brand
mark reused the same accent color and the same "no external
dependency" philosophy the rest of this session's UI work already
established. All five original brainstorm items (typography,
depth/surface, color, layout width, brand mark) are now complete.
