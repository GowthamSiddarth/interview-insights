// Duplicated from api/src/events/schemas/moderation-queue-sla-warning.event.ts
// — same duplicate-rather-than-share reasoning as docs/DECISIONS.md D73/D75.
// The topic name/shape below must stay byte-for-byte identical to api's:
// this is the contract, not an independent definition — see docs/EVENTS.md.
// entityType is plain string here, not a shared Postgres enum — same
// reasoning as moderation-queue-sla-breach.event.ts's own copy.
export const MODERATION_QUEUE_SLA_WARNING_V1_TOPIC = 'moderation.queue.sla_warning.v1';

export interface ModerationQueueSlaWarningEventV1 {
  eventType: 'moderation.queue.sla_warning';
  eventVersion: 1;
  occurredAt: string; // ISO-8601
  queueEntryId: string;
  entityType: string;
  entityId: string;
  slaDeadline: string; // ISO-8601
}
