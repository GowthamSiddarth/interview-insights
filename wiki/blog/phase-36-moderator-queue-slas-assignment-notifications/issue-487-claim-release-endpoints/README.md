# Phase 36, Issue #487 — Claim/Release Endpoints + Moderation Queue UI Affordance

*Part of Phase 36 — Moderator Queue SLAs, Assignment & Notifications. See
`docs/ROADMAP.md` Phase 36 and `docs/DECISIONS.md` D80.*

## The gap this closed

#486 added `claimed_by`/`claimed_at` columns; nothing wrote to them yet.
This issue builds the actual claim/release behavior: two new endpoints,
the service logic behind them, and a queue UI affordance so a moderator
can see and act on a claim without leaving the page.

## Key concept: the caller is never trusted to say who they are

`POST /moderation/queue/:id/claim` and `/release` don't take a moderator
id in the request body at all. Both read it off `AdminJwtAuthGuard`'s
own `req.user` — the same `AdminSessionPayload.id` #485 added:

```ts
@Post('queue/:id/claim')
claim(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
  const moderator = req.user as AdminSessionPayload;
  return this.moderationService.claim(id, moderator.id);
}
```

A moderator can only ever claim or release on their own behalf — there's
no code path where a client-supplied id could claim an entry for someone
else, or release someone else's claim by just naming them.

## Key concept: claiming is a signal, never a gate

Approve/reject/flag never check claim state at all — a claim is an
optional "I've got this" marker, not a lock on who's allowed to review
an entry. This matters because with today's single-moderator reality
(D80), requiring a claim before review would just be friction with no
payoff. `claim()`/`release()` do enforce their own invariants, though:
claiming an already-claimed or already-reviewed entry 409s; releasing a
claim held by another moderator 403s; releasing an unclaimed entry
409s.

```ts
async claim(id: string, moderatorId: string) {
  const entry = await this.prisma.moderationQueueEntry.findUniqueOrThrow({ where: { id } });
  if (entry.reviewedAt) throw new ConflictException('This item has already been reviewed.');
  if (entry.claimedById) throw new ConflictException('This item is already claimed by another moderator.');
  return this.prisma.moderationQueueEntry.update({
    where: { id },
    data: { claimedById: moderatorId, claimedAt: new Date() },
    include: { claimedBy: { select: { id: true, username: true } } },
  });
}
```

## Key concept: the queue read gets a free join, not a second round trip

`listPending()`/`search()` both `include: { claimedBy: { select: { id,
username } } }` on their existing `findMany` calls — one extra join, not
an extra query — so `GET /moderation/queue` already carries the
claiming moderator's username. The web UI never needs a second lookup
to render a "claimed by X" badge.

## Key concept: three UI states, not two

`EntryActions` renders one of three things per entry, keyed off
`entry.claimedBy` and the signed-in moderator's own id (from
`AdminSession`, which also gained `id` in this issue's web-side
change): a **Claim** button when unclaimed; a "claimed by you" badge
plus a **Release** button when the signed-in moderator holds it; or
just a "claimed by `<name>`" badge, no button, when someone else does.
Approve/Reject/Flag render identically in all three states — consistent
with claiming never gating review.

## Step-by-step: what actually got built and verified

1. `ModerationService.claim()`/`release()` — the conflict/forbidden
   rules above, both returning the updated entry with `claimedBy`
   joined in.
2. `POST /moderation/queue/:id/claim` and `/release` on
   `ModerationController`, guarded like every existing route.
3. `listPending()`/`search()` extended with the `claimedBy` include;
   `ModerationQueueEntry`'s TypeScript shape gained `claimedById`/
   `claimedAt`/`claimedBy`.
4. Web: `AdminSession` gained `id`; `ModerationQueueEntry` gained the
   same three claim fields plus `slaDeadline`; `EntryActions` gained
   the three-state Claim/Release/badge-only rendering above.
5. New `loginAsSecondModerator()` e2e test helper (`api/test/support/
   admin-session.ts`) — a fixed, upserted username rather than a fresh
   one per call, since `moderators` isn't among
   `truncate-test-database.ts`'s wiped tables and a timestamped
   username every run would just accumulate rows forever.
6. 65 new/updated api unit tests, new `claim / release` e2e block
   (claim conflict, release-forbidden-for-another-moderator, release
   with no claim), 20 new web unit tests — full suites green, plus
   real CI (including the two Redpanda-dependent e2e files this
   project's local dev environment can't reach without extra setup).

## What this enabled

`slaDeadline`/`claimedById`/`claimedAt` moved from "columns that exist"
(#486) to "columns a moderator can actually act on and see." #488's
breach-detection sweep reads `claimedById` to decide who (if anyone) to
notify; #490's queue-UI SLA badge sits directly next to the claim
affordance this issue built.
