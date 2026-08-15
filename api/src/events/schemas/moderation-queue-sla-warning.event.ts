import { ModerationEntityType } from '@prisma/client';

// Versioned event contract — see docs/EVENTS.md. Published by
// SlaBreachDetectionService's hourly sweep (GitHub issue #704, Phase 51,
// D104) — a new, earlier tier alongside the existing
// moderation.queue.sla_breach.v1: 75% of the SLA window elapsed, still
// unclaimed. Only ever fires for an unclaimed entry (a claimed one
// already has someone on it, per #704's own scope) — no claimedById
// field for that reason, unlike sla_breach.v1's own shape.
export const MODERATION_QUEUE_SLA_WARNING_V1_TOPIC = 'moderation.queue.sla_warning.v1';

export interface ModerationQueueSlaWarningEventV1 {
  eventType: 'moderation.queue.sla_warning';
  eventVersion: 1;
  occurredAt: string; // ISO-8601
  queueEntryId: string;
  entityType: ModerationEntityType;
  entityId: string;
  slaDeadline: string; // ISO-8601
}
