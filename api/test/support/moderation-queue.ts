// GitHub issue #315: GET /moderation/queue groups entries by their
// InterviewProcess rather than returning a flat list. Every e2e spec that
// looks up "the queue entry for entity X" shares this flatten-then-find
// helper instead of duplicating the traversal in each file.

export interface QueueEntryBody {
  id: string;
  entityType: string;
  entityId: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  flagReason: string | null;
  claimedBy: { id: string; username: string } | null;
  entity: Record<string, unknown> | null;
}

export interface QueueGroupBody {
  processId: string | null;
  companyName: string;
  roleTitle: string;
  entries: QueueEntryBody[];
}

export function flattenQueue(groups: QueueGroupBody[]): QueueEntryBody[] {
  return groups.flatMap((g) => g.entries);
}

export function findQueueEntry(groups: QueueGroupBody[], entityId: string): QueueEntryBody | undefined {
  return flattenQueue(groups).find((e) => e.entityId === entityId);
}
