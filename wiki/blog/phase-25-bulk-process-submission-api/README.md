# Phase 25, Issue #251 — Bulk Process-Submission Endpoint

*Part of Phase 25 — Bulk Process Submission API. See `docs/ROADMAP.md`
Phase 25 and `docs/DECISIONS.md` D49.*

## Why this phase exists at all

Every write path this project has built since Phase 2 is incremental:
create a process, then a round, then a rating, one request at a time.
That's fine for a wizard that writes to the database as the candidate
progresses — which is exactly what Phase 26 is about to stop doing.
Phase 26's client-side draft wizard keeps everything in the browser
until the candidate is done, then submits once. That "once" needs
somewhere to land: a single endpoint that accepts the whole tree — the
process, every round and its rating, every recruiter interaction and
its rating, the overall review — and creates all of it atomically.
That's this issue. It was planned alongside Phase 26 from the start,
precisely because Phase 26 can't be built without it.

## Key concept: additive, not a replacement

Every existing per-entity endpoint (`POST /companies/:id/processes`,
`POST /processes/:id/rounds`, `POST /rounds/:id/ratings`, and so on)
stays exactly as it is. The bulk endpoint is a new path for a new
caller (Phase 26's wizard), not a migration away from the old one —
nothing else in this codebase calls it, and nothing forces anything
else to start.

## Key concept: one transaction, one outcome

The issue's own scope flagged something to "decide during
implementation": what happens if part of a bulk submission would fail?
Two live questions were actually tangled together here, and separating
them made the answer obvious:

1. **Does D13's rate limit ever cause a failure to roll back?** No —
   `FraudChecksService` has never blocked a write; it only attaches a
   `flagReason` to the moderation queue entry. A bulk submission that
   trips the rolling 3-ratings/24h window still creates every rating,
   just flagged for closer review. There's no "reject vs. accept
   partially" decision to make here at all, because rate-limiting was
   never a rejection path in this codebase to begin with.
2. **What about a genuine validation or constraint failure — an
   out-of-range rating, an invalid `type_metadata` value?** This is
   where atomicity actually matters, and the answer is the simplest
   one available: the entire tree is created inside one
   `prisma.$transaction()`. Anything that throws — anywhere, on any
   nested entity — rolls back everything Postgres has touched so far.
   A submission either fully succeeds or leaves nothing behind. No
   half-created process with two of three rounds. This isn't a novel
   design; it's exactly the standard behavior every other write path in
   this app already gets from wrapping a create in `$transaction`, just
   applied to a bigger tree.

## Key concept: sequential creation isn't incidental, it's load-bearing

Rounds and recruiter interactions are created in a plain `for...of`
loop, awaited one at a time — not `Promise.all`. That choice matters
for a reason that's easy to miss: `FraudChecksService.checkRateLimit()`
counts existing rows via the *same transaction client* passed all the
way through the bulk create. Within one Postgres transaction, a row
inserted a moment ago by an earlier statement in that same transaction
is visible to a later statement in it. So if a bulk payload includes
four round ratings, the fourth one's rate-limit check correctly counts
the three siblings already inserted earlier in the very same call —
which is exactly the acceptance criterion the issue asked for
("confirming a bulk submission of, say, 4 round ratings in one call is
evaluated against the existing limit correctly"). Running the creates
in parallel would have broken this silently: each fraud check would
race against its siblings' inserts instead of seeing them.

## System design approach

```
api/src/bulk-process-submission/
  dto/
    create-bulk-round.dto.ts                 # CreateRoundDto + optional `rating`
    create-bulk-recruiter-interaction.dto.ts  # identifier + optional `rating`
    create-bulk-process.dto.ts                # CreateInterviewProcessDto + rounds[]/recruiterInteractions[]/overallReview
  bulk-process-submission.controller.ts        # POST /companies/:companyId/processes/bulk
  bulk-process-submission.service.ts
  bulk-process-submission.module.ts
```

The DTOs extend the existing per-entity DTOs directly (`CreateRoundDto`,
`CreateRoundRatingDto`, `CreateRecruiterRatingDto`,
`CreateOverallReviewDto`) rather than redeclaring their fields — the
bulk payload's nested shapes are the same shapes Phase 24 already
finalized, just nested instead of separate requests. The service reuses
the same building blocks every other write path already depends on:
`RoundTypeFieldOptionsService.validateTypeMetadata()` (issue #248),
`FraudChecksService.detectFlagReason()` (D13),
`RecruitersService.findOrCreate()`, and `ModerationService.enqueue()`
— all called with the transaction's `tx` client so everything commits
or rolls back together.

## Step-by-step: what actually got built and verified

1. **The module** — DTOs, service, controller, wired into `AppModule`.
2. **7 new unit tests** (mocked Prisma/services) covering every
   combination: process-only, a round with/without a rating, a
   recruiter interaction with/without a rating, an overall review, and
   everything together in one call.
3. **5 new e2e tests** against real Postgres: 401 unauthenticated,
   process-only submission, a full tree with the right
   `moderation_queue` entries for every rateable entity, atomic
   rollback proven directly (a deliberately invalid second round —
   confirmed via a zero-row query afterward, including the otherwise-
   valid first round), and `candidateId` rejected outright by whitelist
   validation.
4. **A real, incidental bug surfaced adding this to the write-path
   enumeration file**: `sessions-on-write-path.e2e-spec.ts` (issue
   #146's central "assert every candidateId-bearing write path" file)
   had a shared `beforeAll` app instance sitting at exactly 5
   `/auth/request-link` calls — precisely the magic-link throttle
   limit — across its original four write-path tests plus one
   candidateId-rejection test. Adding the bulk endpoint as a sixth
   write path tipped it over, failing with a 429 instead of the
   expected assertion. Fixed by converting the file to a fresh app per
   test (`beforeEach`/`afterEach`), the same fix this class of problem
   has needed elsewhere in this codebase.
5. **Live-verified** via curl against the real dev Postgres: a real
   magic-link login, a full bulk submission (two rounds, one rated;
   one recruiter interaction with a rating; an overall review)
   confirmed landing as exactly 2 rounds / 1 round rating / 1 overall
   review / 3 moderation-queue entries via direct Postgres queries —
   and a deliberately invalid second round confirmed rolling back the
   *entire* submission, zero rows persisted, including the first round
   that would otherwise have been perfectly valid on its own.

## What this enabled

Phase 26's draft wizard now has exactly what it needs: a single call
that turns a fully-built client-side draft into a real submission,
with the same moderation, fraud-check, and registry-validation
guarantees every incremental write already had — and a clean, provable
all-or-nothing failure mode so a half-submitted draft can never become
a half-created process in the database.
