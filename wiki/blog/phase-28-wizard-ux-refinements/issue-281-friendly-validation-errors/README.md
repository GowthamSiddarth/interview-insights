# Phase 28, Issue #281 — Friendly, Actionable Validation Errors on Submit

*Part of Phase 28 — Wizard UX Refinements. See `docs/ROADMAP.md` Phase 28
and epic #280.*

## Why a dotted path is the wrong thing to show a candidate

Submitting an incomplete draft — say, a recruiter touchpoint added with
no name or email — used to reach the bulk endpoint, get rejected by
`class-validator`, and show the raw response verbatim:

```
recruiterInteractions.0.recruiterIdentifier should not be empty
```

That string is exactly right for a backend developer debugging a
request and exactly wrong for a candidate trying to finish a review.
Array indices and dotted field paths mean nothing to someone who never
saw the request body.

## Key concept: block invalid submissions before they're requests at all

The better fix isn't a nicer error message — it's not sending the
request in the first place. `validateDraft()` (`web/src/lib/
draft-store.ts`) is a pure function that checks the same things the
backend would reject: a missing role title, an empty recruiter
identifier on any added touchpoint, and any rating value outside 1-5.
It runs live on every render (no separate state to keep in sync), and
the review screen's Submit button stays disabled while any issue
exists — the invalid request never leaves the browser.

## Key concept: the review screen already had everything needed to point at the problem

Each step on the review screen already had an "Edit" link jumping back
to that step (issue #255). Validation issues reuse the same idea: a
"Fix these before you can submit" box lists every problem in plain
English, each with its own "Fix" link that jumps straight to the
offending step — `stepId` doubles as both a validation-issue key and a
navigation target.

## Key concept: a humanizer for the error the client-side check can't anticipate

Client-side validation can't cover every shape a 400 might take (a
future field, an edge case in a nested DTO). For that residual case,
`ApiError` now carries the raw un-joined `messages` array alongside
its existing joined `message` string — nothing that already reads
`.message` breaks. A small `humanizeSubmitValidationMessage()` maps
the known `field.path should not be X` / `array.index.field should not
be X` shapes to plain English using two lookup tables (field labels,
section labels), and falls back to a generic "Please check the
highlighted fields and try again." for anything it doesn't recognize
— deliberately not a general class-validator translator, just enough
for what this one endpoint can actually produce.

## System design approach

```ts
// draft-store.ts — pure, no I/O, recomputed on every render
export function validateDraft(draft: ProcessDraft): DraftValidationIssue[]

// page.tsx
const validationIssues = activeDraft ? validateDraft(activeDraft) : [];
<ReviewScreen validationIssues={validationIssues} ... />

// review-screen.tsx
<Button disabled={submitting || isEmpty || validationIssues.length > 0}>
```

## Step-by-step: what actually got built and verified

1. `validateDraft()` added to `draft-store.ts`, checking role title,
   round rating bounds, recruiter identifiers, recruiter rating bounds,
   and overall-review bounds.
2. `ReviewScreen` gained a `validationIssues` prop: a summary box with
   Fix links, and per-row amber highlighting for any step with an
   issue.
3. `ApiError` gained `messages: string[]`; `humanizeSubmitValidationMessage()`
   and `submitErrorMessage()` added to `page.tsx` for the backend-error
   fallback path.
4. 5 new tests: `validateDraft()` unit coverage (role title, recruiter
   identifier, round/recruiter/overall rating bounds, a fully-valid
   draft), a component test proving an incomplete draft blocks Submit
   and never calls the network, and a component test proving a
   `should not be empty` backend shape renders humanized text, never
   the raw dotted path.

## What this enabled

The exact bug report that started this phase — a meaningless
validation string on screen — can no longer happen for the two cases
it was originally seen in, and the underlying mechanism (block first,
humanize what slips through) covers any similar case going forward
without needing a fix per field.
