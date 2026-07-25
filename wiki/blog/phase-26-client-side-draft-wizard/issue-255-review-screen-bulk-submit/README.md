# Phase 26, Issue #255 — Chronological Review Screen + Bulk-Submit Integration

*Part of Phase 26 — Client-Side Draft Wizard (Flashcard Navigation). See
`docs/ROADMAP.md` Phase 26 and `docs/DECISIONS.md` D49.*

## Why this is the issue that closes the loop

Everything since issue #253 has been building toward one moment: the
instant a candidate is done drafting and hits submit. Up to this point
in the phase, the entire wizard experience was pure client-side state —
no network call beyond picking or creating a company. This issue is
where that state finally becomes real data, via exactly one call to
Phase 25's bulk endpoint. Everything before this screen was rehearsal;
this is the only step that matters to the backend at all.

## Key concept: chronological order is a display concern, not a data concern

Rounds get filled in whatever order the candidate feels like adding
them — maybe the system design round gets fleshed out before the
technical screen that actually happened first. The review screen has to
present them in the order they actually occurred, not the order they
were typed. Fortunately, this didn't need any new data: rounds already
carry a real `sequenceNumber` (a genuine field in the bulk payload, not
just a UI convenience), so sorting by that value gives the true
chronological order for free. Recruiter steps use the client-only
`timing` field from issue #254 — every `'start'` step sorts before all
rounds, every `'end'` step sorts after, and the overall review always
renders last. None of this changes what gets submitted: `rounds` and
`recruiterInteractions` stay two separate arrays in the actual request,
exactly as `CreateBulkProcessDto` expects. The chronological merge only
exists for the human reading the review screen.

## Key concept: atomicity turned a hard problem into an easy one

Issue #255's own scope anticipated something messy: "a partial/
rate-limit rejection surfaces clearly without losing the draft." That
reads like it needs real design work — distinguishing which parts of a
submission succeeded from which didn't, and reconciling the draft
against a half-completed server state. It doesn't, because of a
decision made back in issue #251: the bulk endpoint is fully atomic
(D49). There is no partial state to reconcile, ever. A submission
either fully succeeds or changes nothing at all. That reduces the whole
failure-handling story to one branch: any error response leaves the
draft completely untouched, shown via the same `ErrorBanner` every
other error path in this app already uses, and the candidate can just
fix whatever was wrong and try again. The complexity the issue seemed to
anticipate had already been designed away four issues earlier.

## Key concept: the success summary doesn't need the server to say anything

A completed submission needs to tell the candidate what happened —
matching `/me`'s existing "your rating is pending" framing. The
straightforward approach would have the bulk endpoint's response echo
back every created row so the frontend can display their real IDs and
statuses. That's unnecessary: every entity this platform has ever
created starts as `pending`, unconditionally (CLAUDE.md's own hard
constraint #2) — there's no scenario where the bulk endpoint would
return anything else. So the success summary is built entirely from
the draft's own local counts (how many rounds had a rating attached, how
many recruiter interactions did, whether an overall review was filled
in) computed a moment before the draft is deleted. No change to the
bulk endpoint's response shape was needed at all — this issue really did
touch nothing outside `web/`.

## Key concept: submit is the only step that ever asks for a session

Every other part of this draft flow — picking a company, adding rounds,
rating them, adding recruiter touchpoints — works without any session at
all, a direct consequence of issue #253's design. The review screen
keeps that promise: its content (the whole chronological summary) is
always visible, logged in or not. Only the Submit button itself sits
behind `GatedSection`, the same tri-state session-hint component used
everywhere else in this app. An anonymous candidate can build up and
review an entire interview record, and only gets asked to log in at the
literal last step, where it actually matters.

## System design approach

```
web/src/app/wizard/review-screen.tsx
  - merges rounds (sorted by sequenceNumber) + recruiter steps (by timing) + overall review
  - each row: a summary + an "Edit" link back to that step (issue #254's navigator)
  - Submit button, gated behind GatedSection

web/src/lib/api.ts
  createBulkProcess(companyId, input)   # POST /companies/:companyId/processes/bulk
  CreateBulkProcessInput / CreateBulkRoundInput / CreateBulkRecruiterInteractionInput
```

The submit handler in `page.tsx` builds the payload by mapping each
step wrapper down to its inner `round`/`interaction` object — exactly
the "no translation step" issue #253 promised, now paid off in full:
`rounds: draft.rounds.map(s => s.round)`.

## Step-by-step: what actually got built and verified

1. **`review-screen.tsx`** — the chronological merge, edit links, and
   the gated submit button.
2. **`api.ts`** gained `createBulkProcess()` and its matching request
   types.
3. **`page.tsx`** wired the submit handler, the success-summary state,
   and a `SubmissionSuccess` card replacing the drafts list on success.
4. **10 new component tests** (`wizard-review-submit.spec.tsx`) covering
   chronological sorting with steps filled out of order, edit links
   jumping back correctly, a successful submit clearing the draft with
   the right summary, a failed submit leaving the draft intact, and the
   submit button specifically (not the whole screen) being gated behind
   login.
5. **Live-verified end to end** with a real headless browser against the
   real `kind` cluster: logged in via a real magic link, filled process
   details, added two rounds and two recruiter touchpoints in
   deliberately non-chronological order (one round left intentionally
   unrated, to prove that submits fine too), filled an overall review,
   reloaded the page mid-draft and resumed successfully, confirmed the
   review screen's chronological ordering was correct despite the
   scrambled fill order, submitted for real, and confirmed via direct
   Postgres queries that exactly 2 rounds, 1 round rating, 2 recruiter
   interactions, 1 recruiter rating, and 1 overall review had landed —
   all `pending` — with zero console errors throughout.

## What this enabled

The client-side draft wizard is now a complete, working replacement for
the old incremental one — genuinely resumable, freely navigable,
reviewable before submission, and backed by exactly one atomic write
instead of five-to-ten separate ones. Phase 26 is done: the wizard a
candidate uses today no longer resembles the one this project shipped
in Phase 2, and every property that made the old one fragile — lost
progress on a refresh, no way to add a second round of the same type,
no way to see the whole picture before committing — is gone.
