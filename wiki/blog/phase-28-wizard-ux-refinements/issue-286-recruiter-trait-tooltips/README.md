# Phase 28, Issue #286 — Tooltips for Recruiter Trait Ratings

*Part of Phase 28 — Wizard UX Refinements. See `docs/ROADMAP.md` Phase 28
and epic #280.*

## Why a label alone wasn't enough

The recruiter rating fields — `reachability`, `responsiveness`,
`guidelinesShared`, and the separate `rejectionMessageAuthenticity` —
were rendered with only a camelCase-derived label
(`field.replace(/([A-Z])/g, ' $1')`). That's fine for a field a
candidate already understands, but these four traits were deliberately
redesigned in Phase 24 (issue #249) specifically because their
boundaries are subtle: "responsiveness" (kept to promised timelines) is
easy to conflate with "reachability" (could you get in touch at all),
and "rejection message authenticity" only makes sense at all once you
know what it's asking. A label alone doesn't carry that nuance.

## The fix

Each field gets a one-sentence tooltip via the plain HTML `title`
attribute — no new dependency, no custom component:

```tsx
const RATING_FIELD_TOOLTIPS: Record<(typeof RATING_FIELDS)[number], string> = {
  reachability: 'How easy the recruiter was to reach or get a response from.',
  responsiveness: 'How quickly and reliably they followed up or kept to promised timelines.',
  guidelinesShared: 'How clearly they explained the process, format, and what to expect at each stage.',
};
```

matching the exact definitions Phase 24's kickoff brainstorm (D48)
already established for these fields — this issue didn't invent new
meanings, it just made the existing ones visible. A dotted underline
on each label (`cursor-help underline decoration-dotted`) signals
there's something to hover, since a bare `title` attribute alone gives
no visual hint that it exists.

## What this enabled

A candidate rating a recruiter interaction can now hover any trait and
see, in one sentence, exactly what it's asking — closing the gap
between Phase 24's carefully-considered field redesign and what
actually reached the person filling out the form.
