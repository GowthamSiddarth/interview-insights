// Versioned event contract — see docs/EVENTS.md for the versioning
// convention. `v1` appears in both the topic name and the type name so a
// future breaking change (a `v2`) can ship as a new topic/type without
// every existing consumer having to update in lockstep.
export const ROUND_RATING_CREATED_V1_TOPIC = 'moderation.round_rating.created.v1';

export interface RoundRatingCreatedEventV1 {
  eventType: 'moderation.round_rating.created';
  eventVersion: 1;
  occurredAt: string; // ISO-8601, event creation time — not necessarily the DB row's createdAt
  roundRatingId: string;
  roundId: string;
  candidateId: string;
  companyId: string;
  status: 'pending'; // always 'pending' at creation — see docs/DATA_MODEL.md
}
