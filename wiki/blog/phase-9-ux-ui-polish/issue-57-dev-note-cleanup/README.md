# Phase 9, Issue #57 — Remove Internal Dev-Note Leaks and Fix Stale Moderation Copy

*Part of Phase 9 — UX/UI Polish Pass. See `docs/ROADMAP.md` Phase 9.*

## Why this came first

The audit that kicked off this whole phase (walking every page after
Phase 7's Kubernetes deployment went live) found the same failure mode
in three separate places: text written for a developer reading the code
during Phase 2 or Phase 4 was still there, verbatim, in what a real user
would see. This is the cheapest, most self-contained fix in the phase —
pure copy changes, no new components, no structural risk — which is
exactly why it's a reasonable place to start a phase with four other,
larger issues still ahead of it.

## Key concepts

- **A comment explaining *why* code exists is not the same as user-facing
  copy explaining *what's happening*, and conflating them is an easy
  mistake under time pressure.** "Every rating starts pending until a
  moderator approves it (docs/DECISIONS.md D3)" is exactly the right
  thing to write down — as a code comment, for the next person reading
  this file. It is exactly the wrong thing to render on screen, where a
  real candidate has no use for a citation to an internal decisions log.
  The fix in this issue wasn't deleting that reasoning — it was moving it
  to where it belongs (a comment) and writing something different in its
  place for the actual audience (a user who just submitted a rating and
  wants to know what happens next).
- **A comment can go stale exactly the way rendered text can — the fix
  has to check both.** The homepage told users to expect the public
  rating count to stay at zero "until Phase 3's moderation worker
  exists." That was true the day it was written (Phase 2, before Phase 3
  built moderation) and false every day since Phase 3 shipped. This
  wasn't just unpolished — it was actively wrong, and it's a useful
  reminder that any copy referencing a future feature needs a plan for
  updating it once that feature actually exists, or it silently becomes
  a lie.

## System design approach

Three call sites, three small rewrites, following the same pattern each
time: identify what a real user actually needs to know, write that
plainly, and — where the original internal reasoning was worth
preserving — move it into a comment adjacent to the code it explains,
not delete it outright.

```tsx
// Before (web/src/app/page.tsx)
<p className="text-gray-500">
  Every rating starts <code>pending</code> and stays invisible to the public until a
  moderator approves it (docs/DECISIONS.md D3). The public ratings list below is
  expected to be empty until Phase 3&apos;s moderation worker exists.
</p>

// After
{/* Every rating is moderated before it's public (docs/DECISIONS.md D3) —
    a pending rating won't count below until it's approved. */}
<p className="text-gray-500">
  Thanks for sharing your experience. Every rating is reviewed before it
  becomes public, so yours may not appear in the count below right away.
</p>
```

The new copy makes a narrower, still-true claim: "may not appear right
away" — accurate whether moderation takes a minute or a week, and never
promises a specific number the way the old copy implicitly did (zero,
always).

## Step-by-step: what actually got built

1. **Grepped the entire `web/src` tree** for internal doc paths, phase
   numbers, and internal entity names (`docs/DECISIONS`, `docs/
   DATA_MODEL`, `Phase [0-9]`, `InterviewProcess`, `RoundRating`) —
   rather than fixing only the three spots already noticed during the
   audit, to make sure nothing else was missed.
2. **Rewrote the homepage subtitle** — from a description of the Phase 2
   entity chain to a plain description of what the product does.
3. **Rewrote the post-rating message** — fixed both the raw doc citation
   and the stale "expect zero" claim in the same edit, moving the real
   reasoning into a comment.
4. **Rewrote the analytics dashboard subtitle** — same treatment, moving
   the D4 citation into a comment above the paragraph.
5. **Confirmed via a second grep pass** that every remaining match was
   inside a `{/* ... */}` comment, not rendered JSX text.

## What this enabled

This issue set the concrete pattern the rest of the phase's more
structural work builds on: user-facing copy states what a user needs to
know, in plain language; internal reasoning worth preserving lives in a
comment next to the code. Every component built later in this phase
(`NavBar`, `Button`, `PageContainer`) follows the same discipline —
their own comments cite the GitHub issue and explain the *why*, never
duplicating that reasoning into anything a real user would see.
