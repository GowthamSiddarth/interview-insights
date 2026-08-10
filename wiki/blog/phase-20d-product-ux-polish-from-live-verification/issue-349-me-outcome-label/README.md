# Phase 20, Issue #349 — Labeling `/me`'s Process Outcome Distinctly From Moderation Status

*Part of Phase 20d — Product/UX Polish from Live Verification (originally
filed under Phase 20 — Operational Hardening & Live-Verification
Findings, epic #214, split out 2026-08-09 — see `docs/ROADMAP.md`'s
Phase 20 retired stub). Epic #214 reopened and re-closed the same day,
same precedent as #222/#240/#278/#312/#347. See `docs/ROADMAP.md`
Phase 20d and `docs/DECISIONS.md` D55.*

## A negative result led somewhere useful

Issue #347 fixed the public company profile page's flat-list problem —
grouping approved round ratings by submission instead of one row per
round. The natural follow-up question was whether `/me` (a candidate's
own submissions page) had the same bug. It didn't: `MeService.
findMySubmissions()` has grouped by `InterviewProcess` since Phase 17,
well before issue #315 ever introduced this grouping pattern for the
moderation queue. One card per process, with every nested round
rating, recruiter rating, and overall review listed inside it — exactly
the right shape already.

But checking the actual rendered page surfaced something else, a real
if smaller usability problem sitting one line away.

## Two fields that share vocabulary by coincidence, not design

`InterviewProcess.outcome` (`offer` / `rejected` / `withdrawn` /
`ghosted` / `in_progress`) is the candidate's own self-reported result
of their interview loop — did the company make an offer, reject them,
did they withdraw, and so on. It has nothing to do with content
moderation. But every nested item on the same process card — round
ratings, a recruiter rating, an overall review — shows its own
independent moderation status, drawn from a *different* enum that
happens to also include the word `rejected` (alongside
`approved`/`pending`/`flagged`).

The rendering made this collision worse than it needed to be: the
process card showed the outcome as a bare word —

```tsx
{outcomeLabel(entry.outcome)} · started {new Date(entry.createdAt).toLocaleDateString()}
```

— with no label distinguishing it from the five (or more) moderation
statuses displayed right below it. A process whose candidate reported
being rejected by the company displayed a bare "Rejected" sitting
directly above a list of items that all said "Approved." Read quickly,
it looks like a sixth moderation verdict, and specifically the wrong
one.

## The fix is one word, deliberately

```tsx
Outcome: {outcomeLabel(entry.outcome)} · started {new Date(entry.createdAt).toLocaleDateString()}
```

No data changed, no new field, no restructuring — just a label that
names what the value actually is. This is the smallest possible fix
that removes the ambiguity: a reader now sees "Outcome: Rejected" and
"Tech Screening — Approved" as two visibly different kinds of fact,
because they're printed differently, not just because a reader happens
to remember which field means what.

## Verified without needing new tests

The existing test suite already had a test asserting `screen.
getByText('Rejected')` — reading it closely showed it was checking a
mocked *recruiter rating's* moderation status (`status: 'rejected'`),
not the process outcome (which was `'in_progress'` in that same test
fixture). The two assertions never collided, so no test needed
updating; all 125 web tests, the build, and lint stayed green with the
one-line change.

## What this enabled

A small thing, but the kind of small thing that erodes trust in a
product if left alone — a candidate glancing at their own submissions
page should never have to wonder whether "Rejected" means their
application or their content. It now says exactly which.
