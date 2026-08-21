import { PillTone } from '@/components/StatusPill';
import { ModerationRejectionReason } from '@/lib/api';

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

// GitHub issue #688/#691 (Phase 49, D104) — a moderator's own stated
// rejection reason, human-readable. Shared by the moderator queue
// (prior-review history, GitHub issue #691) and /me (GitHub issue #729,
// follow-up to #688) — was previously defined only in
// web/src/app/moderation/page.tsx, duplicated here rather than kept in
// sync by hand across two page files.
export const REJECTION_REASON_LABEL: Record<ModerationRejectionReason, string> = {
  low_quality: 'Low quality',
  guideline_violation: 'Guideline violation',
  identifying_information: 'Identifying information',
  spam_or_promotional: 'Spam or promotional',
  inaccurate_or_unverifiable: 'Inaccurate or unverifiable',
  other: 'Other',
};
