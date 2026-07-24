# Phase 17, Issue #150 — Update/Delete Under Moderation-Safe Rules

*Part of Phase 17 — Candidate Self-Service. Depends on issue #149 (the
`/me` page these controls live on). See `docs/ROADMAP.md` Phase 17 and
`docs/DECISIONS.md` D33.*

## Why this closes a debt as old as the project

Phase 2's original scope note deferred Update/Delete outright: "rating/
review edits after submission would undermine the moderation model
anyway." That was true without auth to gate who could call them — but
it was never a permanent no. This issue is the deliberate, scoped
answer: candidates *can* edit or delete their own moderated content,
under rules that keep hard constraint #2 (everything starts `pending`)
intact rather than working around it.

## Key concept: content types only, never structural entities

The kickoff brainstorm drew a hard line before any code was written:
Update/Delete applies to exactly three entity types —
`RoundRating`, `RecruiterRating`, `OverallReview` — and never to
`Company`/`InterviewProcess`/`Round`/`RecruiterInteraction`. The
reasoning is about what kind of thing each table holds: a rating is an
opinion, and opinions can legitimately change or get retracted without
undermining anything. "There was a round called Technical Screen" is a
fact about what happened, not an opinion — editing or deleting that
would rewrite history, not correct an impression. This distinction
matters again in issue #151, where GDPR erasure *does* reach the
structural entities, for an entirely different reason (see that post).

## Key concept: an edit never touches public content in place

```ts
async update(roundId: string, id: string, candidateId: string, dto: CreateRoundRatingDto) {
  const rating = await this.prisma.roundRating.findFirstOrThrow({ where: { id, roundId } });
  if (rating.candidateId !== candidateId) {
    throw new ForbiddenException('You can only edit your own rating.');
  }
  return this.prisma.$transaction(async (tx) => {
    const updated = await tx.roundRating.update({ where: { id }, data: { ...dto, status: 'pending' } });
    await this.moderationService.reenqueue('round_rating', id, tx);
    return updated;
  });
}
```

An edit resets `status` to `pending` and goes back through the full
moderation gate — exactly like a brand-new submission. There's no
"quietly patch the approved row" path, because that would let a
candidate change what's publicly displayed without anyone reviewing
the new version.

## Key concept: `reenqueue()` — the bug that would only show up with real timing

The obvious version of "re-enqueue for moderation" is just calling the
existing `enqueue()` again. That's wrong the moment an edit happens
*before* the first review completes: the original submission still has
a live, unreviewed `moderation_queue` entry, and creating a second one
leaves two entries pointing at the same entity. A moderator reviewing
either one flips the entity's status — so reviewing both, in either
order, means the second decision silently overwrites the first.

```ts
async reenqueue(entityType: ModerationEntityType, entityId: string, tx: PrismaTransaction = this.prisma) {
  await tx.moderationQueueEntry.deleteMany({ where: { entityType, entityId, reviewedAt: null } });
  return tx.moderationQueueEntry.create({ data: { entityType, entityId } });
}
```

Deleting any still-unreviewed entry before creating the fresh one
guarantees exactly one live entry per entity, always. This is the kind
of bug that unit tests mocking Prisma calls can't really catch on their
own — it only becomes visible once you write the e2e test that edits
*before* approving, which is exactly what
`update-delete-moderated-content.e2e-spec.ts` does.

## Key concept: ownership is a 403, missing is a 404 — deliberately distinct

```ts
const rating = await this.prisma.roundRating.findFirstOrThrow({ where: { id, roundId } });
if (rating.candidateId !== candidateId) {
  throw new ForbiddenException('You can only edit your own rating.');
}
```

`findFirstOrThrow` scopes by the parent id too (`{ id, roundId }`), not
just `{ id }` — a rating id that exists but under a different round
404s, rather than silently succeeding or leaking that the id exists
elsewhere. The ownership check is a separate step, deliberately
returning 403 rather than folding it into the same query as a 404 —
"this exists but isn't yours" and "this doesn't exist" are different
facts, and collapsing them would make it harder to debug either case
later.

## Key concept: delete cascades to search, but only where it was ever indexed

```ts
async remove(roundId: string, id: string, candidateId: string): Promise<void> {
  const rating = await this.prisma.roundRating.findFirstOrThrow({ where: { id, roundId } });
  if (rating.candidateId !== candidateId) {
    throw new ForbiddenException('You can only delete your own rating.');
  }
  await this.prisma.$transaction(async (tx) => {
    await this.moderationService.removeQueueEntries('round_rating', id, tx);
    await tx.roundRating.delete({ where: { id } });
  });
  if (rating.status === 'approved') {
    await this.reviewSearchService.removeReview(id);
  }
}
```

Only `round_rating` was ever indexed into OpenSearch (D17's scope
note) — recruiter ratings and overall reviews never got a search
consumer, so their `remove()` implementations skip this step entirely.
`removeReview()` is best-effort, run after the transaction commits,
same D16/D17 pattern as every other search-index mutation: it silently
accepts a 404 (never indexed — the rating was still
pending/rejected/flagged at delete time) and only logs anything else,
never blocking a DB delete that's already committed.

## Key concept: a shared edit throttle, one budget across all three types

The kickoff brainstorm's explicit, non-default choice: a *single*
per-candidate throttle shared across `RoundRating`/`RecruiterRating`/
`OverallReview` edits, not three independent counters. The abuse this
guards against — repeatedly editing to churn the moderation queue with
fresh entries — doesn't care which entity type the churn comes from.

```ts
// api/src/common/edit-throttle.module.ts
@Module({
  providers: [EditThrottleService, EditThrottleGuard],
  exports: [EditThrottleService, EditThrottleGuard],
})
export class EditThrottleModule {}
```

## The DI bug this surfaced: exporting the guard isn't enough

The first version of `EditThrottleModule` only exported
`EditThrottleGuard`, not `EditThrottleService`. Every e2e test failed
at app bootstrap:

```
Nest can't resolve dependencies of the EditThrottleGuard (?).
Please make sure that the argument EditThrottleService at index [0]
is available in the RoundRatingsModule module.
```

A guard referenced by class in `@UseGuards(EditThrottleGuard)` is
resolved from the *consuming* controller's own module — so that
module needs every one of the guard's own dependencies visible too,
not just the guard class itself. `LoginThrottleGuard`/
`MagicLinkThrottleGuard` never hit this, because their throttle
service is declared directly in the same module as their own usage —
this is specifically a cross-module sharing problem, introduced the
moment the throttle logic moved into its own reusable module. Fixed by
exporting both. Documented in `docs/DECISIONS.md` D33 so the next
shared-guard extraction doesn't rediscover this the hard way.

## Step-by-step: what actually got built and verified

1. **`update()`/`remove()` on all three ratings services**, following
   the pattern above — singular-resource shape for `OverallReview`
   (`UNIQUE(process_id)`, no separate id needed).
2. **`ModerationService.reenqueue()`/`removeQueueEntries()`** — the
   supersede-then-create and delete-everything-for-this-entity
   primitives both write paths share.
3. **`ReviewSearchService.removeReview()`** + a new
   `isNotFoundError()` util in `opensearch-errors.util.ts`.
4. **New routes**: `PATCH`/`DELETE /rounds/:roundId/ratings/:id`,
   `PATCH`/`DELETE /recruiter-interactions/:recruiterInteractionId/ratings/:id`,
   `PATCH`/`DELETE /processes/:processId/overall-review`.
5. **26 new unit tests** (244 total) across the throttle,
   `ModerationService`, `ReviewSearchService`, and all three ratings
   services.
6. **A new 13-test e2e suite**
   (`update-delete-moderated-content.e2e-spec.ts`, 102 e2e total)
   against real Postgres + OpenSearch: owner-only 403 per entity type;
   an edit after approval resets to pending with the reviewed queue
   entry superseded; an edit *before* any review also collapses to
   exactly one live queue entry; deleting an approved round rating
   removes it from public reads, the queue, and the OpenSearch index;
   deleting a still-pending rating still cleans up its queue entry;
   the shared throttle trips on the 6th edit.
7. **`web/src/app/me/page.tsx`** gained per-item Edit/Delete controls —
   an inline edit form pre-filled with current values, a
   `window.confirm`-gated delete button. A successful action just
   refetches `GET /me/submissions` rather than hand-patching nested
   state, since the server-side status reset is the actual source of
   truth. 3 new component tests (51 web tests total).
8. **Live verification** (real `kind` Postgres/OpenSearch/Mailpit via
   port-forward, real dev servers, headless Chromium): logged in,
   submitted a rating, approved it as admin, confirmed `/me` showed
   "Approved," edited the rating — confirmed it flipped to "Pending"
   *and* that the moderation queue held exactly one live entry for it,
   proving the supersession directly rather than trusting the e2e
   suite alone — then deleted it and confirmed both the per-process
   "no ratings submitted yet" note and the queue entry's removal, zero
   console errors throughout.
