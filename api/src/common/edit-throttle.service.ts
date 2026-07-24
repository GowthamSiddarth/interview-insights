import { Injectable } from '@nestjs/common';
import { IpThrottle } from './ip-throttle';

// Per-candidate, not per-IP (GitHub issue #150, Phase 17 kickoff
// brainstorm) — extends D13's rate-limiting pattern to edits: without
// this, nothing stops a candidate repeatedly editing the same rating to
// churn the moderation queue with fresh entries. A single shared
// instance across RoundRating/RecruiterRating/OverallReview edits (all
// three import EditThrottleModule), since the abuse pattern — repeated
// edit-driven re-enqueues — is the same regardless of entity type.
// Same known single-instance limitation as IpThrottle's other consumers
// (D13): in-memory, resets on restart, wouldn't coordinate across
// replicas.
const WINDOW_MS = 60 * 60 * 1000;
const MAX_EDITS_PER_WINDOW = 5;

@Injectable()
export class EditThrottleService {
  private readonly throttle = new IpThrottle({
    windowMs: WINDOW_MS,
    maxAttemptsPerWindow: MAX_EDITS_PER_WINDOW,
  });

  isBlocked(candidateId: string): boolean {
    return this.throttle.isBlocked(candidateId);
  }

  recordAttempt(candidateId: string): void {
    this.throttle.recordAttempt(candidateId);
  }
}
