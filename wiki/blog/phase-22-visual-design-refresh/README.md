# Phase 22 — Visual Design Refresh

*A mechanical visual-polish pass, not a redesign, filed 2026-07-24
from the same UI/UX brainstorm that produced Phase 21. See
`docs/ROADMAP.md` Phase 22 and `docs/DECISIONS.md` D41.*

## Why this is worth writing up: "not cool" is a real, checkable claim

The brainstorm that kicked this off started from a single, blunt
sentence: the app "looks simple but not cool." That's the kind of
feedback that's easy to nod along with and hard to act on directly —
"cool" isn't a Tailwind class. The useful next step wasn't guessing at
what "cool" might mean, but inventorying the actual styles in use and
seeing what the gap really was.

## Key concept: the inventory found a real gap, not just missing polish

A full grep across every page and component turned up three concrete
facts, not vibes:

- **Zero custom theme.** `tailwind.config.ts` had no font, no extended
  color palette, no shadow scale — the pure Tailwind defaults.
- **Eleven duplicated card strings.** The exact same
  `"flex flex-col gap-3 rounded border border-gray-200 p-4
  dark:border-gray-700"` appeared, character-for-character, across 11
  separate call sites in 6 different page files — never extracted into
  a shared component, unlike `Button`/`EmptyState`/`ScoreDisplay`.
- **No page background at all, light or dark.** `layout.tsx`'s `<body>`
  had no `bg-*` class whatsoever. This one matters beyond aesthetics:
  a shadow only reads as "this surface is elevated" if it has something
  visually distinct underneath it to cast onto. Without a page
  background, adding a shadow to a card would have been invisible or
  looked wrong — this had to be fixed *first*, not as a nice-to-have
  alongside the rest.

Two of these (the duplicated card and the missing background) aren't
subjective design opinions — they're just gaps a thorough look at the
code surfaced, the same way any other codebase inventory would.

## Key concept: scoping out what's actually subjective

Five candidate directions came out of the initial brainstorm:
typography, depth/surface, color palette, layout width, and a brand
mark. Three were mechanical, low-risk, and could be evaluated
objectively (does the font load, does the shadow render, does the
container get wider) — those became this phase's scope. Two — an
expanded color palette and an actual brand mark/logo — are real design
taste calls with no obviously-correct answer, so they were deliberately
**not** attempted here and named explicitly as a second-pass option.
Bundling a taste-dependent decision into a set of otherwise-mechanical
fixes would have made the whole PR harder to evaluate on its own terms.

## System design approach

**Typography** — `Inter` via `next/font/google`, which fetches and
self-hosts the font files at `next build` time rather than the
browser requesting them from Google's CDN at runtime:

```tsx
import { Inter } from 'next/font/google';
const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });
```

wired into Tailwind through `fontFamily.sans: ['var(--font-sans)',
'ui-sans-serif', 'system-ui', 'sans-serif']` — the fallback chain
matters for anything rendered outside the root layout (a bare
component test, for instance), where the CSS variable is never set.

**Depth & surface** — the page background fix came first
(`bg-gray-50`/`dark:bg-gray-950` on `<body>`), then a new `Card`
component:

```tsx
interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: 'div' | 'section';
}

export function Card({ as: Tag = 'div', className = '', ...props }: CardProps) {
  return (
    <Tag
      {...props}
      className={`rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900 ${className}`}
    />
  );
}
```

The `as` prop exists for one reason: most of the 11 call sites were
`<section>` elements carrying real document-outline semantics (each
holds its own `<h2>`), and forcing all of them into a generic `<div>`
just to fit a simpler component signature would have quietly degraded
the page's structure. `GatedSection`'s dashed "locked" placeholder
deliberately did **not** get folded into `Card` — it stayed
`rounded-lg`, dashed, and shadow-less, since the whole point of that
component is to look like a placeholder, not a real card; giving it
the same shadow treatment would have blurred a distinction that's
actually useful to a user.

Every hover state (buttons, links, inputs) gained `transition-colors`.
Worth noting: there was no `transition-*` class anywhere in the
codebase before this — a genuinely greenfield addition, not a change
to an existing convention.

**Layout width** — `PageContainer` gained a `size` prop:

```tsx
export function PageContainer({ children, size = 'narrow' }: { ... }) {
  const maxWidth = size === 'wide' ? 'max-w-4xl' : 'max-w-2xl';
  return <main className={`mx-auto flex ${maxWidth} flex-col gap-8 p-8`}>{children}</main>;
}
```

`narrow` (unchanged `max-w-2xl`) for every form-shaped page — the
wizard, login, admin login, verify, my-reviews. `wide` (`max-w-4xl`)
for the four genuinely data-heavy pages — search, company profile,
analytics, moderation queue — where a single 672px column was wasting
horizontal space on grids and lists. `NavBar`'s own inner wrapper had
independently hardcoded `max-w-2xl` since it was first built; left
alone, it would have looked narrower than every "wide" page underneath
it. Synced to `max-w-4xl` (the widest a page ever gets) and given a
real surface (`bg-white`/`dark:bg-gray-900`) so it reads as its own
distinct chrome bar against the new page background, rather than
floating borderless on it.

## Step-by-step: what actually got done

1. Full codebase inventory via a single Explore pass: every `page.tsx`
   and what container/content type it holds, every bare `rounded`
   occurrence, every card-boundary border, the root layout, existing
   `hover`/`transition` conventions, and — importantly — which test
   files assert on specific className strings (only one, `button.spec
   .tsx`, checking `bg-indigo-600`; unaffected by any change here).
2. Filed Phase 22's milestone, epic (#230), and two issues (#231
   feature, #232 this blog) before writing any code, per the
   established "plan a phase before implementing" convention.
3. Added the font, the page background, the `Card` component, the
   `PageContainer` size prop, and the `NavBar` width sync; swept every
   page for the remaining bare `rounded`/flat-border instances and
   brought them in line (`rounded-md` for controls, `rounded-xl` for
   cards) — a final grep confirmed zero bare `rounded` classes remained
   anywhere except `GatedSection`'s deliberately-distinct placeholder.
4. Full web test suite (65 tests), lint, and build all clean — the
   className-only nature of this change meant no test logic needed
   updating.
5. Rebuilt and rolled out the real `web` image against the live `kind`
   cluster. Verified live: a headless-browser (Playwright) pass
   confirmed the `Inter` font actually loaded (`getComputedStyle`
   showing `Inter, "Inter Fallback", ...` rather than a fallback-only
   stack), the page background rendered the correct color per theme in
   both light and dark, and `<main>`'s computed `max-width` was 672px
   on narrow pages and 896px on wide ones — then took actual
   screenshots in both themes to confirm the shadows and card surfaces
   visually read as elevated, not just computed correctly. Zero
   console errors throughout.

## What this enabled

A concrete, checkable answer to feedback that started as a single
subjective sentence — three real, mechanical gaps (missing font,
duplicated card styling, an absent page background) fixed in one pass,
with the genuinely subjective directions (color, branding) named and
deliberately deferred rather than guessed at.
