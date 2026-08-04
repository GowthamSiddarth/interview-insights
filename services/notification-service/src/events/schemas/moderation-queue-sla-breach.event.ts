// Duplicated from api/src/events/schemas/moderation-queue-sla-breach.event.ts
// — same duplicate-rather-than-share reasoning as docs/DECISIONS.md D73/D75.
// The topic name/shape below must stay byte-for-byte identical to api's:
// this is the contract, not an independent definition — see docs/EVENTS.md.
export const MODERATION_QUEUE_SLA_BREACH_V1_TOPIC = 'moderation.queue.sla_breach.v1';

export interface ModerationQueueSlaBreachEventV1 {
  eventType: 'moderation.queue.sla_breach';
  eventVersion: 1;
  occurredAt: string; // ISO-8601
  queueEntryId: string;
  entityType: string;
  entityId: string;
  slaDeadline: string; // ISO-8601
  claimedById: string | null;
}
