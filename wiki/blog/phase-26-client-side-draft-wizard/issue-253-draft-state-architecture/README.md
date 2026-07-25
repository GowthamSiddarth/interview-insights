# Phase 26, Issue #253 — Client-Side Draft State Architecture

*Part of Phase 26 — Client-Side Draft Wizard (Flashcard Navigation). See
`docs/ROADMAP.md` Phase 26 and `docs/DECISIONS.md` D50.*

## Why the wizard needed to stop writing to the database immediately

Every wizard this project had ever shipped — all the way back to Phase
2 — wrote to the database one step at a time: create the process, then
the round, then the rating, each an independent HTTP request the moment
you clicked submit on that step. That's a reasonable design when the
wizard is a strict, linear, top-to-bottom form. It stops being
reasonable the moment you want a candidate to add a second coding round,
reorder things, or just refresh the page without losing an hour of
typing. Phases 24 and 25 existed specifically to make a different design
possible: stable rating field shapes (Phase 24) and a single atomic bulk
endpoint (Phase 25, D49) that could accept an entire interview-process
tree in one call. Issue #253 is where that possibility actually becomes
real: a draft that lives entirely in the browser until the candidate is
ready to submit it once.

## Key concept: the draft *is* the request body

The most consequential design decision in this issue is also the
simplest to state: the draft's stored shape mirrors
`CreateBulkProcessDto` (Phase 25's request shape) directly, field for
field. A `DraftRoundStep` wraps a `DraftRound` that has the exact same
keys as the bulk endpoint's round entry, plus one thing the backend
never sees: a `clientId`, generated locally, that exists purely so
React has something stable to key list items and navigation on. There
is no separate "draft schema" that then gets translated into a
"submission schema" at the end — submitting is just stripping a couple
of client-only fields and making the network call. This was an explicit
requirement in the issue itself, and it paid off immediately: issue
#255's submit handler is a few lines of `.map()`, not a transformation
layer.

## Key concept: this is the first client-side persistence in this whole codebase

A quick grep confirmed it: zero prior uses of `localStorage` or
`sessionStorage` anywhere in `web/`. Every bit of session state up to
this point lived in cookies (httpOnly for the real session, a plain
`candidate_logged_in` hint cookie for cheap synchronous checks). That
meant there was no existing pattern to extend — the storage design here
is genuinely greenfield: one versioned key
(`interview-insights:drafts:v1`) holding a `Record<string, ProcessDraft>`.
One blob rather than one key per draft plus an index, because a
candidate realistically has a handful of drafts at most, and a single
blob can't drift out of sync with an index that tracks it separately.

## Key concept: a draft needs no login at all — only submitting does

This one wasn't an explicit design goal; it fell directly out of the
shape of the system once you look at it. A draft never carries a
`candidateId` — nothing about editing it touches the network, so
there's nothing to attribute to anyone until the real submit call
(issue #255) hits an endpoint that's actually gated by
`CandidateJwtAuthGuard`. That means an anonymous visitor can pick an
existing company and build up an entire interview review before ever
being asked to log in — a materially better experience than the old
wizard, which asked for a session before you could even create a
process.

## Key concept: `crypto.randomUUID()` isn't just a testing inconvenience

Every draft/step ID needed generating client-side, and the obvious
choice — `crypto.randomUUID()` — immediately threw in the Jest/jsdom
test environment. The easy read is "jsdom's crypto shim is incomplete,
add a test-only workaround." That read is wrong, or at least
incomplete: `crypto.randomUUID()` requires a secure context by spec,
and every environment this project actually deploys to today is plain
HTTP on a non-`localhost` origin (D27 — no TLS anywhere yet). A real
browser hitting the real deployed app would hit the exact same failure
jsdom surfaced in a test. The fix is a small feature-detected
`generateId()` — real UUID when the API is actually available, a
timestamp-plus-random fallback otherwise — applied everywhere, not
gated behind `NODE_ENV === 'test'` or similar. A client-only draft ID
has no security property to uphold anyway, so the fallback isn't a
compromise.

## System design approach

```
web/src/lib/draft-store.ts
  ProcessDraft, DraftRoundStep, DraftRecruiterStep, ...   # types mirroring the bulk DTOs + client-only fields
  listDrafts / getDraft / createDraft / saveDraft / deleteDraft
  addRoundStep / updateRoundStep / removeRoundStep
  addRecruiterStep / updateRecruiterStep / removeRecruiterStep
  setOverallReview
  generateId()                                             # feature-detected UUID fallback
```

Every function is pure except the thin `readStore`/`writeStore` pair at
the bottom, which are the only two places that touch `window.localStorage`
directly (guarded by `typeof window === 'undefined'` for SSR safety, the
same idiom `hasCandidateSessionHint()` already used for `document`).

`web/src/app/page.tsx` was rewritten around this: company pick-or-create
(now reusing the existing `GatedSection` component instead of a
hand-rolled tri-state conditional — a small free cleanup) leads to a
"Your drafts" list once any exist, and selecting or creating one opens a
minimal editor for just the process-detail fields, auto-saved on every
change. The old incremental round/rating/recruiter/overall-review steps
are removed in this same PR, with a placeholder note where they used to
be — they come back, backed by the draft store, in issues #254 and #255.
This is the same "the next issue fixes what this one breaks" sequencing
Phase 16 (#146 → #147) and Phase 18 (#159 → #160) already established.

## Step-by-step: what actually got built and verified

1. **The full data layer** — types, CRUD, and the round/recruiter
   add-remove-update helpers, even though nothing calls the
   round/recruiter helpers until issue #254. Keeping the data layer
   complete in one place matched this issue's own scope.
2. **`page.tsx` rewritten** for company → drafts-list → minimal
   process-detail editor.
3. **New `ErrorBanner` component**, extracted from its previous inline
   definition, since upcoming wizard files need it too.
4. **9 new unit tests** (`draft-store.spec.ts`) covering creation,
   reload-persistence, two-simultaneous-companies non-corruption,
   ordering, deletion, and corrupted-data tolerance; `page.spec.tsx`
   rewritten for the new flow.
5. **Live-verified** with a real headless browser against the real
   `kind` cluster: a real magic-link login, company creation opening a
   draft automatically, an edited role title surviving a full page
   reload, resuming showing the field correctly pre-filled, and
   deleting removing the draft while the company itself correctly
   remained available in the picker — zero console errors throughout.

## What this enabled

A genuinely resumable, multi-company-capable draft that survives a
crashed tab or an accidental refresh — something the old wizard could
never offer, since every step was already committed to the database the
moment you clicked its own submit button. More importantly for the rest
of this phase: issues #254 and #255 both had a stable, well-tested data
layer to build directly on top of, rather than having to design storage
and UI simultaneously.
