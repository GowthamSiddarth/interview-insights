# Phase 21 — Anonymous Visitor Soft-Gating

*A deliberate product pivot, filed 2026-07-24, that partially reverses
Phase 15's fully-public design. See `docs/ROADMAP.md` Phase 21 and
`docs/DECISIONS.md` D40.*

## Why this is a pivot, not a bug fix

A UI/UX brainstorm session raised three things at once: general visual
polish, a real NavBar bug (session cookies were host-only — Phase 20,
issue #222), and a request that the company profile page, analytics
dashboard, and "change company" be "gated behind login." That third
item is not obviously a bug fix or a missing feature — it's a direct
contradiction of Phase 15's own stated design intent. `docs/ROADMAP.md`
literally named that phase "Public Company Profile Pages," built on the
premise that this product is "Glassdoor for interview loops": public
discoverability isn't an accident there, it's the whole point.

Rather than silently implement something that reverses an already-
documented decision, the right move was to ask why. The answer:
deliberate signup pressure, not a scraping/abuse concern and not a
misunderstanding of what was already public. That distinction matters —
an abuse concern would call for rate limiting or bot detection; a
signup-pressure goal calls for a completely different kind of change,
one aimed at conversion, not security.

## Key concept: soft gate, not a wall

The second question worth asking directly was *how hard* the gate
should be. A hard gate — redirect anonymous visitors straight to
`/login` before they see anything — maximizes signup pressure but
shows a curious first-time visitor nothing to justify the ask. A soft
gate — some content free, the rest behind a "log in to see more"
prompt — is the pattern Glassdoor itself uses for its own deeper
content, and it's what got chosen here: enough to hook someone, not
enough to feel like a wall.

## Key concept: teased, not hidden by default

Two established conventions were re-examined for how they'd interact
with a new "logged out" state, since neither obviously anticipated it:

- **CLAUDE.md hard constraint #3** ("never show a raw average, never
  display a score below n=3, return null") is about a score's
  *reliability*, not who's allowed to view it. A soft gate is a new,
  separate access layer sitting on top of that rule — it doesn't touch
  the shrinkage-scoring or null-handling logic at all. A gated section
  and an under-the-floor `null` score are two independent reasons a
  number might not be visible, and the code keeps them that way.
- **No SEO trade-off to weigh.** Both target pages are `'use client'`,
  fully client-rendered after mount with no SSR — a crawler sees no
  real content today regardless of gating, so "does this hurt
  indexing" wasn't actually a live concern here, just one worth ruling
  out explicitly rather than assuming.

## Key concept: gate the destination, not the front door

The homepage wizard's company picker and its "Change company" button
were the one place worth pushing back on scope, rather than
implementing literally. Both are pure navigation and state-reset
actions — picking a company just decides which company's profile/
analytics you'll look at next; "Change company" just clears that
choice. Neither displays any company data itself. There's nothing to
tease in a button that resets local state. The actual gate belongs on
the pages that *show* something — the profile and analytics pages
themselves — and reaching them, however you got there (the wizard, a
search result's "View profile" link, a direct URL), lands on the same
gated content either way. Gating the front door would have added a
second gate with no additional protection behind it.

## System design approach

A single new component, `web/src/components/GatedSection.tsx`,
deliberately mirrors `EmptyState.tsx`'s minimal one-prop-object style —
this codebase's established shape for a reusable UI primitive:

```tsx
interface GatedSectionProps {
  loggedIn: boolean | null;
  prompt: string;
  children: React.ReactNode;
}

export function GatedSection({ loggedIn, prompt, children }: GatedSectionProps) {
  if (loggedIn === null) return null; // still checking the session hint
  if (loggedIn) return <>{children}</>;
  return (
    <div className="rounded border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center dark:border-gray-600 dark:bg-gray-800">
      <p className="text-sm text-gray-600 dark:text-gray-300">{prompt}</p>
      <Link href="/login" className="mt-2 inline-block text-sm font-medium text-indigo-600 underline dark:text-indigo-400">
        Log in to unlock
      </Link>
    </div>
  );
}
```

The `loggedIn` prop is driven by `hasCandidateSessionHint()` — the
exact tri-state cookie-hint idiom `NavBar.tsx` and the wizard already
established (D32): `null` while the check hasn't run yet (so a gated
section never flashes on the way to its real state), `false`/`true`
otherwise. No network call, no new backend endpoint — both pages were
already public `GET`s, and this is purely a presentation decision made
entirely in the browser.

**Company profile page** — the free hook is the header (name,
industry, size) and the "Overall experience" section; everything past
that is gated:

```tsx
<GatedSection loggedIn={candidateSession} prompt="Log in to see the full round-type breakdown">
  {/* per-round-type score breakdown */}
</GatedSection>
```

The reviews section always shows the real total count and the first
review in full — `reviews.items[0]` renders unconditionally — with
`reviews.items.slice(1)` plus the pagination controls wrapped in a
second `GatedSection` whose prompt names the real remaining count
(`Log in to see the other N reviews`).

**Analytics page** — since its own copy already frames it as "the full
analytics breakdown," the deep-dive upsell from the profile page's own
link, all three data sections (overall, round-type, recruiter) sit
inside one combined gate rather than three separate ones — a visitor
who's already seen the profile page's free hook gets nothing further
without logging in.

## Step-by-step: what actually got built and verified

1. Diagnosed the NavBar bug first (Phase 20, issue #222) since it was
   the concrete, in-progress item — confirmed it was cookie-domain
   scoping, unrelated to this pivot.
2. Asked two clarifying questions before writing any code: why gate at
   all (signup pressure, confirmed), and how hard (soft gate,
   confirmed) — both via `AskUserQuestion`, since guessing wrong on
   either would have meant redoing real product-shaped work.
3. Explored the four candidate pages (profile, analytics, search,
   wizard homepage) plus the existing `ScoreDisplay`/`EmptyState`
   component conventions before designing anything, to confirm what
   was actually already there to reuse.
4. Entered plan mode given the scope (multi-page, reverses a documented
   decision) — the plan explicitly flagged the "homepage picker stays
   ungated" scope call for the user to correct if wrong, rather than
   assuming silently.
5. Filed Phase 21's milestone, epic (#225), and two issues (#226
   feature, #227 this blog) before writing any code, per the
   established "plan a phase before implementing" convention.
6. Built `GatedSection`, wired it into both pages, extended the
   existing profile/analytics page test suites with logged-in/logged-
   out cases (reusing the same `document.cookie` mock helper already
   established in `nav-bar.spec.tsx`/`page.spec.tsx`) — this also
   surfaced that the pre-existing pagination test assumed no gating
   existed and needed to log in first to keep exercising that path.
7. Full web test suite (77 tests), lint, and build all clean.
8. Rebuilt and rolled out the real `web` image against the live `kind`
   cluster, seeded a fresh company with real approved content via
   direct API calls (candidate login → company → process → two round
   ratings → overall review, approved directly via SQL since only the
   moderation *outcome* mattered for this check, not re-testing the
   moderation flow itself), and ran a live headless-browser
   (Playwright) pass through the actual Ingress-fronted app: anonymous
   visits showed the free hook plus gate prompts with the underlying
   content genuinely absent from the page (not just visually hidden);
   a real magic-link login revealed everything with no prompts left
   over. Zero console errors throughout. Test data cleaned up from the
   dev database afterward.

## What this enabled

A concrete, working answer to "drive more signups" that doesn't
quietly undo Phase 15's public-discoverability premise — anonymous
visitors still get a real reason to trust the product before being
asked to create an account, and the two richest pages now double as a
conversion funnel rather than either full walls or fully open books.
