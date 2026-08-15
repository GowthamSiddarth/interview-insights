# Phase 49, Issue #691 — Surface Prior-Submission History in the Moderator Queue UI

*Part of Phase 49 — Resubmission Loop & Rejection Feedback.
See `docs/ROADMAP.md` Phase 49, D104.*

## The gap

A moderator re-reviewing an edited/resubmitted entry saw no context that
it had been rejected before, or edited more than once. The historical
`ModerationQueueEntry` rows already existed — `reenqueue()` only ever
deletes the still-unreviewed duplicate, so every past reviewed decision
stays in the table — but nothing surfaced them anywhere.

## The fix: a `decision` column, then a batched lookup

The queue entry had no column recording what was actually decided
(`approved`/`rejected`/`flagged`) independent of the entity's own
status, which resets to `pending` on every resubmission. Reconstructing
it from `flagReason`/`rejectionReasonCategory` alone turned out to be
unreliable — a stale fraud-check `flagReason` set at *enqueue* time can
persist on an `approved` row's queue entry, since `approve()`/`reject()`
never explicitly clear it. So a small, honest new column instead, reusing
the existing `ModerationStatus` enum:

```prisma
decision ModerationStatus? @map("decision")
```

`review()` writes it alongside every other decision field. Fetching
prior history is then one batched query in `enrichEntries()` — shared by
`listPending()` and `search()` — rather than N+1 per entry:

```ts
private async fetchPriorReviews(entries: RawQueueEntry[]) {
  const rows = await this.prisma.moderationQueueEntry.findMany({
    where: {
      reviewedAt: { not: null },
      OR: entries.map((e) => ({ entityType: e.entityType, entityId: e.entityId })),
    },
    orderBy: { reviewedAt: 'desc' },
    select: { id: true, entityType: true, entityId: true, decision: true,
              reviewedAt: true, reviewedBy: true, rejectionReasonCategory: true, reviewNote: true },
  });
  // group by `${entityType}:${entityId}` into a Map
}
```

`reviewedAt: { not: null }` alone is enough to exclude a *pending*
entry's own history from matching itself — every caller of
`enrichEntries()` only ever passes still-unreviewed entries in the first
place. The frontend renders it as a "Resubmitted" panel, and is also the
first place `rejectionReasonCategory`/`reviewNote` (#688) get rendered
anywhere — that field existed on the wire since #688 but nothing ever
displayed it until this issue.

## Verification

Backend: new unit tests for `fetchPriorReviews()`'s batching and empty
case, plus a real-Postgres e2e case driving a reject → resubmit cycle
and asserting the new pending entry's `priorReviews` array carries the
prior decision, category, note, and reviewer. Frontend: a new render
test asserting the panel shows "Resubmitted — 1 prior submission" with
the human-readable rejection reason, note, and reviewer name; six
existing fixtures needed a `priorReviews: []` field added since the type
is no longer optional.
