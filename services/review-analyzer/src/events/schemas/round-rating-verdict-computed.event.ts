// GitHub issue #340, docs/DECISIONS.md D81 — this service's write-back to
// api: the full verdict payload AiModerationService.requestVerdict() used
// to write directly onto the entity row and act on in-process, now
// published as an event instead. api's verdict-consumer (its first-ever
// event consumer) applies moderationVerdict and runs its existing
// approveWithAudit() auto-approval flow when autoApprovalEligible is true —
// this service never touches moderation_queue itself. Duplicated
// byte-for-byte into api/src/events/schemas/ — the topic name/shape below
// is the contract, not an independent definition, see docs/EVENTS.md.
export const ROUND_RATING_VERDICT_COMPUTED_V1_TOPIC = 'moderation.round_rating.verdict_computed.v1';

export interface RoundRatingVerdictComputedEventV1 {
  eventType: 'moderation.round_rating.verdict_computed';
  eventVersion: 1;
  occurredAt: string; // ISO-8601
  roundRatingId: string;
  // null only when stalled is true (the reconciliation sweep's staleness-
  // escalation path, GitHub issue #442/#340) — no LLM result to carry, just
  // the signal that this row needs a human-visible flag.
  verdict: Record<string, unknown> | null;
  autoApprovalEligible: boolean;
  confidence: number | null;
  model: string | null;
  promptContent: string | null;
  responseText: string | null;
  // Present and true only when review-analyzer's own reconciliation sweep
  // re-triaged a stale row and it's still unresolved — api's consumer routes
  // this to ModerationService.flag() (ai_triage_stalled) instead of storing
  // a verdict. Absent on every normal, freshly-computed verdict.
  stalled?: true;
}
