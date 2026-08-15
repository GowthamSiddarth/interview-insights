import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Per-candidate, not per-IP (GitHub issue #150, Phase 17 kickoff
// brainstorm) — extends D13's rate-limiting pattern to edits: without
// this, nothing stops a candidate repeatedly editing the same rating to
// churn the moderation queue with fresh entries. A single shared
// EditThrottleModule across RoundRating/RecruiterRating/OverallReview
// edits, since the abuse pattern — repeated edit-driven re-enqueues — is
// the same regardless of entity type.
//
// GitHub issue #693 (Phase 49, D104) — Postgres-backed (EditThrottleState
// model), replacing the old in-memory IpThrottle core: that state reset on
// restart and, once `api` runs more than one replica, would give each pod
// its own independent 5-per-hour bucket — silently multiplying the
// effective limit by the replica count. State now lives in one shared
// table instead.
const WINDOW_MS = 60 * 60 * 1000;
const MAX_EDITS_PER_WINDOW = 5;

@Injectable()
export class EditThrottleService {
  constructor(private readonly prisma: PrismaService) {}

  // Replaces the old isBlocked()/recordAttempt() pair with one atomic
  // call: checking and recording as two separate round trips (as the old
  // in-memory version effectively did, single-threaded-JS-atomic between
  // them) would reopen a TOCTOU gap once the check has to `await` a
  // database call — two concurrent requests from the same candidate could
  // both see "under the cap" before either one's write lands, letting both
  // through. Returns true (and counts the attempt) iff this request is
  // allowed.
  async recordAttemptIfAllowed(candidateId: string): Promise<boolean> {
    const now = new Date();
    const windowFloor = new Date(now.getTime() - WINDOW_MS);

    // Fast path: atomically bump an existing, still-current window —
    // succeeds only if the row exists, its window hasn't expired, and
    // it's under the cap, all in the WHERE clause of a single UPDATE.
    // Same atomic-updateMany-with-a-condition-check shape as
    // ModerationService.review()'s own TOCTOU fix (#674/#675) — Postgres
    // row-locks the matching row for the statement's duration, so a
    // second concurrent call can't read a stale count before this one
    // commits.
    const { count: bumped } = await this.prisma.editThrottleState.updateMany({
      where: { candidateId, windowStart: { gte: windowFloor }, count: { lt: MAX_EDITS_PER_WINDOW } },
      data: { count: { increment: 1 } },
    });
    if (bumped > 0) return true;

    // The fast path matched nothing: either no row exists yet, its window
    // has already expired, or the cap is already hit within the current
    // window. Only the last of those three is actually blocked.
    const current = await this.prisma.editThrottleState.findUnique({ where: { candidateId } });
    if (current && current.windowStart >= windowFloor) {
      return false;
    }

    // No row, or an expired window: start a fresh one. upsert's
    // ON CONFLICT DO UPDATE is itself atomic per row (Postgres row-level
    // locking on the unique candidateId key), so two concurrent callers
    // racing to start the same fresh window can't corrupt this row —
    // worst case, the second writer's count: 1 simply overwrites the
    // first's, which under-counts by at most one at a window boundary
    // (strictly more permissive, never less safe than intended).
    await this.prisma.editThrottleState.upsert({
      where: { candidateId },
      create: { candidateId, windowStart: now, count: 1 },
      update: { windowStart: now, count: 1 },
    });
    return true;
  }
}
