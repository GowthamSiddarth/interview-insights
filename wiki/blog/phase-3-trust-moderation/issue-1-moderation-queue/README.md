# Phase 3, Issue #1 — Moderation Queue

*Part of Phase 3 — Trust & moderation. See `docs/ROADMAP.md` Phase 3,
`docs/DECISIONS.md` D3/D12, `docs/DATA_MODEL.md` "moderation_queue".*

## Why this came first

Phase 2 proved the full write path works, but every rating it created was
publicly invisible by construction (the read endpoint always filtered to
`status = 'approved'`, and nothing ever flipped that status). Fraud and
fake-review risk is this product's single biggest credibility threat
(`docs/DECISIONS.md` D3), so the very first thing built after the
vertical slice was the mechanism that actually moves a rating from
`pending` to `approved` — without which every later feature (analytics,
search) would have nothing real to work with.

## Key concepts

- **Moderation is a first-class service, not inline logic bolted onto the
  write path.** `docs/ARCHITECTURE.md` calls this out explicitly — keeping
  the write path simple (just insert the row, enqueue a review) and making
  the moderation *decision* logic independently testable and improvable
  later, rather than tangled into `RoundRatingsService.create()` itself.
- **Enqueuing and the write must be atomic.** A rating that exists without
  a corresponding `moderation_queue` entry would be a rating that can
  *never* become visible — nothing would ever review it. A
  `moderation_queue` entry referencing a rating that failed to insert
  would be a dangling review task for nothing. Both failure modes are
  prevented by wrapping the insert and the enqueue in the same database
  transaction.
- **The moderation entity reference is polymorphic by design, not an
  oversight.** `moderation_queue.entity_type` + `entity_id` can point at a
  `round_rating`, `recruiter_rating`, or `overall_review` — three
  different tables — which is why `entity_id` is *not* a foreign key
  (`docs/DATA_MODEL.md` notes this explicitly). A single FK can't
  reference "one of three possible tables" natively in Postgres; the
  alternative (three nullable FK columns, one per entity type) would make
  every future entity type require a schema migration. The tradeoff:
  referential integrity for this column is enforced by application logic,
  not the database — a deliberate, named cost.
- **Build for the interface you'll need, not the implementation you have
  yet.** `ModerationService.review()` already switches on `entityType` and
  throws `NotImplementedException` for anything other than
  `round_rating` — because `recruiter_rating` and `overall_review` don't
  have a write path yet (no service creates them). This makes the gap
  explicit and loud (a clear error) rather than silent (an entry that
  quietly never resolves).

## Core technologies

- **A dedicated NestJS module** (`ModerationModule`) inside the existing
  `api` service — not a separate `workers` process, not a Kafka/Redpanda
  consumer, despite `docs/ARCHITECTURE.md`'s target diagram describing
  moderation as event-driven off a bus.
- **Prisma's `$transaction`**, used two ways in this codebase: the
  enqueue-on-write path takes an already-open transaction as a parameter
  (so the caller controls the transaction boundary and can include other
  work in the same atomic unit), while the review-decision path opens its
  own transaction internally (since approving/rejecting is a
  self-contained unit of work with nothing else that needs to join it).

## System design approach — the in-process decision (D12)

This is the single most important design decision in this phase, and it's
worth understanding *why* it was made rather than just *what* was built,
because the same reasoning gets reapplied verbatim to two more decisions
later in the project (D13's fraud checks, D16's search indexing).

`docs/ARCHITECTURE.md`'s target architecture has ratings flow through
Kafka to a moderation service that does human review plus ML flagging.
But at this point in the project, **nothing produces to that bus** —
there's no Kafka/Redpanda running locally at all (Phase 1.3 deliberately
cut it, see that post). Standing up a consumer for a queue that nothing
populates would be exactly the "premature infrastructure" `docs/
DECISIONS.md` D9 warns against — a whole extra system to run, monitor,
and debug, in service of an architecture pattern (event-driven
decoupling) that has no second consumer yet to actually benefit from it.

The counter-argument — "but doesn't checking synchronously slow down the
write path?" — doesn't actually apply here, and understanding *why* it
doesn't is the transferable lesson: enqueuing is a single, fast `INSERT`
into `moderation_queue` inside the same transaction as the rating write.
The *slow* part event-driven design is meant to protect against is
expensive fraud/ML *scoring* work (Phase 3 issue #2, and any future
ML-based scoring) — and issue #2's fraud checks turned out to fit the
same in-process pattern too, for the same reason, once actually measured
against real work rather than assumed to need decoupling. The rule this
established: **decouple when there's a real, measured cost to co-locating
the work — not because a reference architecture diagram says to.**

```typescript
// RoundRatingsService.create() (evolved through issues #1 and #2)
create(roundId: string, dto: CreateRoundRatingDto) {
  return this.prisma.$transaction(async (tx) => {
    const flagReason = await this.fraudChecksService.detectFlagReason(/* ... */, tx);
    const rating = await tx.roundRating.create({ data: { ...dto, roundId } });
    await this.moderationService.enqueue('round_rating', rating.id, tx, flagReason);
    return rating; // one transaction: rating write + enqueue, atomic
  });
}
```

## The review decision flow

`ModerationService.review()` is the single method underlying all three
public actions (`approve`/`reject`/`flag`), parameterized by decision:

```typescript
private async review(id, decision, dto, flagReason?) {
  const entry = await this.prisma.moderationQueueEntry.findUniqueOrThrow({ where: { id } });
  if (entry.reviewedAt) throw new ConflictException('This item has already been reviewed.');
  if (entry.entityType !== 'round_rating') {
    throw new NotImplementedException(/* recruiter_rating / overall_review: no write path yet */);
  }
  return this.prisma.$transaction(async (tx) => {
    const updated = await tx.moderationQueueEntry.update({
      where: { id },
      data: { reviewedAt: new Date(), reviewedBy: dto.reviewedBy, flagReason },
    });
    await tx.roundRating.update({ where: { id: entry.entityId }, data: { status: decision } });
    return updated;
  });
}
```

Two guard conditions matter here beyond the obvious happy path: a queue
entry that's already been reviewed rejects a second review attempt with
`409` (a moderator can't flip a decision by calling the endpoint twice —
the `reviewedAt` timestamp being non-null is what makes an entry
"already decided"), and the polymorphic-entity gap from above is enforced
right at the point of use, not just documented.

## Step-by-step: what actually got built

1. **Added `moderation_queue` to the schema** — this table actually
   shipped back in Phase 1's first migration (`docs/DATA_MODEL.md`'s full
   spec was implemented all at once), so this issue's job was purely the
   service/controller layer on top of an already-existing table.
2. **Built `ModerationService.enqueue()`**, accepting an already-open
   Prisma transaction as an optional parameter (defaulting to the plain
   `PrismaService` when called standalone) — this is what lets
   `RoundRatingsService.create()` include the enqueue in its own
   transaction rather than `ModerationService` managing its own,
   separate one.
3. **Wired `RoundRatingsService.create()`** to open a transaction, create
   the rating, and enqueue it — both operations succeed or both roll
   back together.
4. **Built `ModerationService.approve/reject/flag`**, each delegating to
   the shared `review()` method with a different decision value, and
   `listPending()` for `GET /moderation/queue` (unreviewed entries only,
   oldest first).
5. **Built the `ModerationController`** at `POST /moderation/queue/:id/
   {approve,reject,flag}` — explicitly noted in its own code comment as
   an internal/admin surface with no auth yet, matching the rest of the
   API's current auth gap, and no moderator UI in front of it either.
6. **Wrote 14 unit tests** (mocked Prisma) covering the guard conditions
   (already-reviewed conflict, unimplemented entity type) and the
   decision-to-status mapping.
7. **Wrote `moderation.e2e-spec.ts`** against a real Postgres, proving the
   full loop: submit a rating → it's enqueued pending → approve it → it's
   now publicly visible via Phase 2's `GET /rounds/:roundId/ratings` —
   plus reject/flag staying hidden, a double-review conflicting (`409`),
   and a not-found entry (`404`).
8. **Filed this work as GitHub issue #1** under a new "Phase 3 — Trust &
   moderation" milestone, the first phase built under this project's
   now-standing "plan the whole phase before implementing any of it"
   convention.

## What this enabled

Every rating and review created from this point forward in the project's
life has flowed through this exact same `enqueue → pending → decision →
status flip` mechanism, unchanged — issue #2's fraud checks *added* a
`flagReason` to the same enqueue call rather than building a parallel
path; Phase 5's review search indexing hooks into the same
`ModerationService.review()` method, triggered by the exact same
`approved` decision. The in-process, no-bus decision made here (D12) is
also the direct precedent cited by name in two later decisions (D13, D16)
— this is the pattern that let the rest of the project avoid rebuilding
the same "should this be a Kafka consumer?" argument from scratch every
time a similar question came up.
