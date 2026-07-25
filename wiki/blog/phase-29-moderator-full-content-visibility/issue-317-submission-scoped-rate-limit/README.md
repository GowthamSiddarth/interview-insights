# Phase 29, Issue #317 — Submission-Scoped Fraud-Check Rate Limit

*Part of Phase 29 — Moderator Full Content Visibility & Submission
Consistency. See `docs/ROADMAP.md` Phase 29 and `docs/DECISIONS.md`
D52.*

## The original ask, and the sharper question that replaced it

The issue started as a straightforward extension: `FraudChecksService.
checkRateLimit()` (3 ratings per rolling 24h window, per candidate,
non-blocking — D13) counted `round_rating` rows only. `recruiter_rating`
and `overall_review` creation had zero fraud-check wiring at all, in
both the single-create paths and the bulk-process-submission endpoint.
The obvious fix looked like: add the same counting logic to the other
two entity types.

While reviewing issue #315's moderation-queue grouping work, the
project owner asked a more fundamental question: should moderation and
rate-limiting be scoped per-entity (per round/recruiter rating, per
overall review) or per-submission (per `InterviewProcess`)? The two
concerns turned out to need different answers — and one of them
exposed a real bug in the existing design, not just a gap.

## Key concept: moderation stays per-entity — the live data proved why

Issue #315's own verification data made this concrete: a real
submission had 3 coding-round ratings, 2 clean and 1 auto-flagged
`rate_limit`. A moderator needs to approve the 2 good ones and handle
the 1 suspicious one on its own terms. If moderation acted on the whole
submission as a unit, there'd be no way to do that — either the
suspicious entry gets waved through to keep the legitimate content
public, or the whole submission gets rejected and two clean ratings are
lost with it. No change needed here; it was already correct.

## Key concept: the old rate limit was flagging normal usage as abuse

The recruiter/overall-review gap was real, but a second look at the
existing round-rating limit found something worse: it counted
`round_rating` rows per candidate per rolling 24h — but Phase 25/26
built this platform specifically so **one legitimate submission can
contain several round ratings** (a real multi-round interview loop).
Counting per-entity meant a single genuine submission could trip its
own "abuse" signal. That's exactly what the live data showed: the 3rd
round rating in one real 5-entity submission was auto-flagged purely
for being the candidate's 3rd rating *that day* — nothing about its
content was actually suspicious. The unit being counted was wrong, not
merely incomplete.

## The fix: count submissions, not entities

```ts
async checkRateLimit(candidateId: string, tx: PrismaTransaction = this.prisma): Promise<boolean> {
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const count = await tx.interviewProcess.count({
    where: { candidateId, createdAt: { gte: windowStart } },
  });
  return count >= RATE_LIMIT_MAX_SUBMISSIONS;
}
```

One interview loop with 5 rounds is 1 event under this model, not 5.
This also resolves the issue's own original kickoff question (a shared
counter across all three entity types, or three independent ones) by
making it moot: there's exactly one counter now — submissions — and it
doesn't depend on which entity type is being created within one.
`detectFlagReason()` gained a `ModerationEntityType` parameter (reusing
the existing Prisma enum rather than inventing a new type), threading
through to a new `fetchExistingFreeText()` that switches on entity type
to scan the correct table/field — `round_rating.freeText`,
`recruiter_rating.freeText`, or `overall_review.reviewText` — so
duplicate-text detection extends to all three entity types while
staying scoped to each one's own field, never cross-type.

## Why this didn't need a distributed-transaction trick

The bulk-process-submission endpoint creates a process and every round/
rating/interaction inside one `$transaction` (D49). A natural worry:
does the new submission-count check need special handling for entities
created in the *same* call as their own process? It doesn't — Postgres
transaction semantics mean a `SELECT` later in a transaction sees rows
already inserted earlier in that same transaction. Since the process is
created before its own rounds/ratings in the bulk flow, `tx.
interviewProcess.count()` correctly includes it by the time any of its
own child entities check the limit — no special-casing needed for bulk
vs. incremental creation.

## Step-by-step: what actually got built and verified

1. `FraudChecksService.checkRateLimit()` rewritten to count
   `InterviewProcess` rows; constant renamed
   `RATE_LIMIT_MAX_SUBMISSIONS`.
2. `checkDuplicateFreeText()`/`detectFlagReason()` gained an entity-type
   parameter; a new private `fetchExistingFreeText()` scopes the scan
   per entity type/field.
3. `RecruiterRatingsService`/`OverallReviewsService` gained
   `FraudChecksService` as a constructor dependency for the first
   time, wired into `create()` exactly like `RoundRatingsService`
   already was. Both modules gained a `FraudChecksModule` import.
4. `BulkProcessSubmissionService`'s round-rating call gained the
   entity-type argument; recruiter-rating and overall-review creation
   gained fraud-check wiring they'd never had.
5. 11 fraud-checks unit tests + 6 new/updated tests across the three
   services' and the bulk-submission's spec files (301 api unit tests
   total) — including a test proving the same rate-limit signal
   applies identically regardless of entity type.
6. A rewritten `fraud-checks.e2e-spec.ts` (8 tests, 134 e2e total)
   against real Postgres proves: the 3rd submission trips the limit
   while the first two don't; **4 round ratings within one submission
   never trip it** (the exact bug this issue fixed, and the test that
   would have caught it happening again); the limit applies
   identically to recruiter ratings and overall reviews; duplicate
   detection works per entity type and never cross-type.
7. Live-verified against the real `kind` cluster: created 3 separate
   submissions for one candidate, rating each in turn immediately
   after creating its process (interleaving creation and rating was
   itself a real lesson during verification — creating all 3 processes
   upfront before rating any of them reproduces the old bug's
   symptom against the *new* code, since the count already includes
   all 3 by the first rating). Confirmed via both a direct Postgres
   query and the live `GET /moderation/queue` response that only the
   3rd submission's content was flagged.

## What this enabled

The fraud-check signal now measures the thing it was actually meant to
measure — how often a candidate creates new submissions — instead of
penalizing candidates for legitimately detailed ones. Recruiter ratings
and overall reviews get the same fraud-detection coverage round
ratings always had, closing a gap that existed since Phase 14 first
gave those two entity types a write path without ever revisiting D13's
originally round-rating-only scope.
