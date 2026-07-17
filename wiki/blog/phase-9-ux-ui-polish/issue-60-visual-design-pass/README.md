# Phase 9, Issue #60 — Visual Design Pass: Layout Width and Branding Consistency

*Part of Phase 9 — UX/UI Polish Pass. See `docs/ROADMAP.md` Phase 9.*

## Why this came first

Every page in this app was built independently, phase by phase, over the
course of the project — the homepage in Phase 2, the analytics dashboard
in Phase 4, the search page in Phase 5. Each one happened to use the same
`mx-auto max-w-2xl` wrapper and the same `bg-black`/`dark:bg-white`
button styling, purely because whoever built each page copied the
pattern from the page before it. That's consistency by coincidence, not
by design — and the two are distinguishable the moment someone needs to
change the pattern: a coincidence has to be found and fixed in three
places; a design has one place to fix.

## Key concepts

- **Depend on issue #58 landing first, because layout and navigation
  share a coordinate system.** This issue was explicitly scoped to wait
  for the shared `NavBar` to exist, so the width/spacing decisions made
  here would apply to a stable structure, not one that was about to
  change again. Sequencing matters when two issues touch overlapping
  surface area — doing the styling pass before the structural change
  would have meant redoing part of it.
- **"Consistent by coincidence" is invisible until the moment it breaks,
  and that moment is exactly when it's expensive to fix.** Three files
  independently containing `className="rounded bg-black px-3 py-1 text-sm
  text-white dark:bg-white dark:text-black"` works fine right up until
  someone wants to change the accent color — at which point it's a
  find-and-replace across files that happen to match today, with no
  guarantee a fourth page added tomorrow copies the same string
  correctly. Extracting the repeated pattern into a real component
  converts an implicit, coincidental agreement into an explicit,
  enforced one — the same lesson `docs/DECISIONS.md` D19 landed on for
  Helm versus Kustomize, applied here to two small React components
  instead of a Kubernetes tool choice.
- **A monochrome UI isn't a style choice by default — it's the absence
  of one.** Every button in this app used the same black-in-light-mode,
  white-in-dark-mode inversion, and every link was a bare `underline`
  with the surrounding text's own color. That's not "minimalist" as a
  deliberate aesthetic decision — it's simply what's left when no accent
  color was ever chosen. Picking one color (here, Tailwind's built-in
  `indigo`) and applying it everywhere a primary action or a navigational
  link appears is a small change with an outsized effect on whether the
  app reads as designed versus unstyled.

## System design approach

Two shared components, each solving exactly one of the two problems named
in this issue's title:

```tsx
// web/src/components/PageContainer.tsx — the layout-width decision,
// made once, structurally, instead of copy-pasted three times.
export function PageContainer({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto flex max-w-2xl flex-col gap-8 p-8">{children}</main>;
}
```

```tsx
// web/src/components/Button.tsx — the branding decision, made once.
export function Button({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`rounded bg-indigo-600 px-3 py-1 text-sm text-white hover:bg-indigo-700 ${className}`}
    />
  );
}
```

`Button` spreading `{...props}` and accepting a `className` override
(merged, not replaced) is what makes it a genuine drop-in replacement
for the six raw `<button>` elements it consolidates — callers that
needed `type="submit"` or an extra `col-span-full` class (the "Submit
rating" and "Search reviews" buttons, which sit inside CSS grid forms)
keep working exactly as before, with the shared styling applied
underneath whatever they pass in.

One color decision reached into two places that weren't literally
buttons or `<Link>` components: the search page's selected-company
indicator (`border-black dark:border-white` → `border-indigo-600
dark:border-indigo-400`) and every remaining text link (`View analytics
dashboard`, `Change company`, the nav's search link). **Consistency means
finding every place a design decision applies, not just the obvious
ones** — a "this is currently selected" border and a text link are both,
semantically, expressions of the same accent color, even though neither
is a `<Button>`.

## Step-by-step: what actually got built

1. **Audited every `bg-black`/`underline`/`max-w-2xl` occurrence** across
   `web/src` with a direct grep, rather than fixing only the instances
   noticed by eye — this is what surfaced the selected-company border as
   something needing the same treatment as the buttons.
2. **Built `PageContainer`** and swapped it into all three pages'
   `<main>` wrapper, including the analytics dashboard's two early-return
   states (loading, error) that previously used a slightly different,
   narrower wrapper class (`mx-auto max-w-2xl p-8`, missing `flex
   flex-col gap-8`) — unifying all three of that file's render paths onto
   the exact same component, not just the "happy path."
3. **Built `Button`** and replaced all six raw button elements across the
   homepage and search page.
4. **Recolored the remaining text links and the selected-company border**
   to the same accent.
5. **Wrote a component test for `Button`**, covering both that it renders
   its children/forwards props (`type="submit"`) and that a
   caller-provided `className` merges with, rather than replaces, the
   default styling.
6. **Verified in a real browser at two viewport sizes** — 1280×900 and a
   375×812 mobile width — across the homepage and search page, checking
   specifically for the failure mode the audit named (a jarring imbalance
   between content and empty space) rather than just "does it look okay."
   Confirmed clean mobile reflow and zero console errors at both sizes.

## What this enabled

Every page added to this app from this point forward inherits a
consistent look automatically by using `PageContainer` and `Button`,
the same way issue #58's `NavBar` is automatically present on every
route. The explicit scope boundary this issue set for itself — "a
polish pass on the existing Tailwind setup, not a redesign project," no
new dependencies — is itself worth naming as a pattern: meaningful visual
consistency doesn't require a design system or a component library: two
small, well-scoped components and one color decision closed the actual
gap the audit found.
