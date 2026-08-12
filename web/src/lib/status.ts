import { PillTone } from '@/components/StatusPill';

// The one entity-status vocabulary shared by RoundRating, RecruiterRating,
// and OverallReview (GitHub issue #620) — 'pending'/'flagged' previously
// rendered as the *same* amber text color (web/src/app/me/page.tsx's old
// STATUS_CLASS), meaning a candidate couldn't tell "still in the queue"
// from "flagged for fraud review" at a glance. Each status gets its own
// reserved tone here.
export const ENTITY_STATUS_TONE: Record<'pending' | 'approved' | 'rejected' | 'flagged', PillTone> = {
  pending: 'warning',
  approved: 'good',
  rejected: 'critical',
  flagged: 'serious',
};
