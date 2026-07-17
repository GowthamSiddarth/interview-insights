# Phase 9, Issue #58 — Persistent Shared Navigation

*Part of Phase 9 — UX/UI Polish Pass. See `docs/ROADMAP.md` Phase 9.*

## Why this came first

Issue #60 (the visual design pass) was scoped to depend on this issue
landing first, specifically to avoid styling a layout structure that
would need reworking a second time. Before any branding or accent-color
decisions could be made consistent across pages, there needed to be
*one* place those decisions lived — and there wasn't one.
`web/src/app/layout.tsx`, Next.js's App Router root layout — the file
whose entire purpose is wrapping every page in shared structure —
rendered nothing but `{children}`. Every page built its own header from
scratch, and none of them linked back to any other page.

## Key concepts

- **A framework root layout that renders only `{children}` is a real gap,
  not a neutral default.** Next.js's App Router gives every app exactly
  one place, by construction, that's guaranteed to wrap every route:
  `layout.tsx`. Leaving it as a pass-through isn't "no decision made" —
  it's the decision that no page shares anything with any other page,
  which is precisely the bug this issue found (no way back to the
  homepage from `/search` or the analytics dashboard except the browser's
  own back button).
- **Distinguish what's genuinely shared from what's page-specific, and
  don't move more than the first category.** The acceptance criteria
  was explicit about this: each page's own title and description stay
  exactly where they are. Only the navigation — a home link, a search
  link — is genuinely identical across every page and belongs in the
  layout. Moving page titles into a shared layout too would have been
  over-generalizing a structure that's supposed to vary per page.

## System design approach

```tsx
// web/src/components/NavBar.tsx
export function NavBar() {
  return (
    <nav className="border-b border-gray-200 dark:border-gray-700">
      <div className="mx-auto flex max-w-2xl items-center gap-4 px-8 py-3 text-sm">
        <Link href="/" className="font-semibold">Interview Insights</Link>
        <Link href="/search" className="underline">Search companies &amp; reviews</Link>
      </div>
    </nav>
  );
}
```

```tsx
// web/src/app/layout.tsx
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <NavBar />
        {children}
      </body>
    </html>
  );
}
```

Two lines changed in `layout.tsx`, one new component — this is a small
change in line count, but it's structurally the correct place to make
it: every route rendered under this layout, present and future, now
automatically gets the nav bar without that page's own code needing to
know or do anything.

The homepage's own copy of the "Search companies & reviews" link — which
had been living in `page.tsx`'s header before this issue — was removed
once the shared nav covered it, rather than left as a duplicate. A
second, identical link a few pixels below the first one doesn't add
redundancy value; it just reads as an oversight.

## Step-by-step: what actually got built

1. **Built `NavBar`** as a standalone component, taking no props — its
   two links are fixed, not configurable, since there's nothing yet in
   this app that needs a different nav depending on which page it's on.
2. **Wired it into `layout.tsx`**, rendered once, above `{children}`.
3. **Removed the now-redundant search link** from the homepage's own
   header.
4. **Wrote a component test for `NavBar`** in isolation — asserting both
   links' `href` attributes directly, independent of which page happens
   to render it.
5. **Verified in a real browser by navigating directly** to `/search` and
   to the analytics dashboard — not by clicking through the app, since
   that would only prove the links work when a user arrives via the
   wizard, not when they land on a page directly (a bookmark, a shared
   URL, a page refresh). Confirmed the nav renders on both and its
   homepage link works from both, with zero console errors.

## What this enabled

Issue #60's visual design pass modified `NavBar`'s search link color
directly, confident the component existed in exactly one place —
no need to hunt down three separate copies of a "search" link across
three page files. Any future page added to this app inherits the same
navigation automatically, by virtue of being rendered under the same
root layout, without its own code needing to remember to include it.
