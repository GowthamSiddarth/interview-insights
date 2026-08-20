import { ModerationEntityType, ModerationStatus } from '@prisma/client';

// Versioned event contract — see docs/EVENTS.md. GitHub issue #797
// (Phase 54) — the resolution-side counterpart to
// moderation-queue-sla-breach.event.ts/moderation-queue-sla-warning.
// event.ts: both of those are one-shot, purely to prevent
// re-notification, and neither had any signal for when the item they
// warned/breached about was finally acted on — an operational blind spot
// (breach-resolution latency couldn't be audited, and no one was ever
// told an escalation was acted on). Published by ModerationService
// .review() whenever it resolves an entry that had breachNotifiedAt
// and/or warningNotifiedAt set — never for an entry that was reviewed
// within its SLA window in the first place, since there's nothing to
// signal resolution of.
export const MODERATION_QUEUE_SLA_RESOLVED_V1_TOPIC = 'moderation.queue.sla_resolved.v1';

export interface ModerationQueueSlaResolvedEventV1 {
  eventType: 'moderation.queue.sla_resolved';
  eventVersion: 1;
  occurredAt: string; // ISO-8601
  queueEntryId: string;
  entityType: ModerationEntityType;
  entityId: string;
  decision: ModerationStatus;
  reviewedBy: string | null;
  wasBreached: boolean;
  wasWarned: boolean;
  // How late resolution was relative to slaDeadline, in milliseconds —
  // negative would mean it resolved before the deadline (never happens
  // for an event that's only ever published when wasBreached/wasWarned
  // is true, but kept as a signed number rather than clamped, so a
  // consumer can trust the arithmetic rather than a silent floor).
  resolutionLatencyMs: number;
}
