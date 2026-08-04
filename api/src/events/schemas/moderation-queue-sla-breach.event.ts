import { ModerationEntityType } from '@prisma/client';

// Versioned event contract — see docs/EVENTS.md. Published by
// SlaBreachDetectionService's hourly sweep (GitHub issue #488, Phase 36,
// D80) once per breach — never republished for the same queue entry on a
// later sweep tick, tracked via ModerationQueueEntry.breachNotifiedAt.
export const MODERATION_QUEUE_SLA_BREACH_V1_TOPIC = 'moderation.queue.sla_breach.v1';

export interface ModerationQueueSlaBreachEventV1 {
  eventType: 'moderation.queue.sla_breach';
  eventVersion: 1;
  occurredAt: string; // ISO-8601
  queueEntryId: string;
  entityType: ModerationEntityType;
  entityId: string;
  slaDeadline: string; // ISO-8601
  // Who to notify — the moderator holding the claim at breach time, or
  // null if the entry was never claimed. notification-service (#489)
  // logs-and-skips a null claimedById: with no auto-assignment (D80,
  // manual-claim-only), an unclaimed entry has no natural recipient.
  claimedById: string | null;
}
