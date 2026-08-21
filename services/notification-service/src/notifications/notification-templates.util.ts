import { ModerationRejectionReason } from '@prisma/client';

// GitHub issue #729 (follow-up to #688, Phase 49) — human-readable labels
// for the moderator-stated rejection reason, same wording as web's own
// REJECTION_REASON_LABEL (web/src/lib/status.ts) — kept in sync by hand,
// same duplicate-rather-than-share reasoning as every other cross-service
// mirror in this file (D73/D75); the two never need to be literally the
// same module since neither ever imports the other.
const REJECTION_REASON_LABEL: Record<ModerationRejectionReason, string> = {
  low_quality: 'low quality',
  guideline_violation: 'a guideline violation',
  identifying_information: 'identifying information',
  spam_or_promotional: 'spam or promotional content',
  inaccurate_or_unverifiable: 'inaccurate or unverifiable content',
  other: 'other reasons',
};

// reviewNote is moderator-entered free text, not a fixed template string
// like everything else this file builds — the first place this file has
// ever interpolated any variable content into an HTML string. Escaped for
// the html body (never the plain-text one, which needs no escaping) as
// defense-in-depth against a careless/compromised staff account, not
// because a moderator is treated as untrusted the way candidate input is
// elsewhere in this app.
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// GitHub issue #711 (Phase 49, D104) — extracted out of
// notification-consumer.service.ts so ReconciliationSweepService can
// reuse the exact same approved/rejected copy without duplicating it.
// The two "approved"/"rejected" fixed templates D73 anticipated — never
// called for 'flagged' (see notification-consumer.service.ts's own
// comment for why that's a deliberate no-op) or 'pending' (review()
// never re-emits the status it started from).
//
// GitHub issue #729 (follow-up to #688, Phase 49) — rejectionReasonCategory/
// reviewNote are optional: every existing caller (approve() path, and
// ReconciliationSweepService's sweep, which doesn't have these on hand at
// all — see its own call site) still gets the original plain copy.
export function subjectAndBodyFor(
  newStatus: 'approved' | 'rejected',
  rejectionReasonCategory?: ModerationRejectionReason | null,
  reviewNote?: string | null,
): {
  subject: string;
  text: string;
  html: string;
} {
  if (newStatus === 'approved') {
    return {
      subject: 'Your submission has been approved',
      text: "Good news! Your submission has been reviewed and approved. It's now live.",
      html: "<p>Good news! Your submission has been reviewed and approved. It's now live.</p>",
    };
  }

  const reasonLabel = rejectionReasonCategory ? REJECTION_REASON_LABEL[rejectionReasonCategory] : null;
  const reasonClause = reasonLabel ? ` The reason given was: ${reasonLabel}.` : '';
  const textNoteClause = reviewNote ? ` Moderator note: "${reviewNote}"` : '';
  const htmlNoteClause = reviewNote ? ` Moderator note: "${escapeHtml(reviewNote)}"` : '';

  return {
    subject: 'Your submission was not approved',
    text: `Your submission was reviewed and was not approved.${reasonClause}${textNoteClause} Thank you for taking the time to share your feedback.`,
    html: `<p>Your submission was reviewed and was not approved.${reasonClause}${htmlNoteClause} Thank you for taking the time to share your feedback.</p>`,
  };
}

// The one fixed template for a *.created event — also reused by
// ReconciliationSweepService (#711) for a missed pending-review email.
//
// GitHub issue #692 (Phase 49, D104) — isResubmission distinguishes a
// candidate's first-time submission from an edit that resubmitted
// rejected/flagged content (api's ModerationService.publishCreatedEvent()
// now fires this same event shape from update()'s reenqueue() path too).
// Defaults to false so every existing caller (ReconciliationSweepService's
// sweepCreated(), scoped to genuinely first-time submissions only, D106)
// is unaffected.
export function pendingReviewSubjectAndBody(isResubmission = false): {
  subject: string;
  text: string;
  html: string;
} {
  if (isResubmission) {
    return {
      subject: 'Your edited submission is back in review',
      text: "Thanks for the update! Your edited submission is back in our moderation queue and will be reviewed shortly.",
      html: "<p>Thanks for the update! Your edited submission is back in our moderation queue and will be reviewed shortly.</p>",
    };
  }
  return {
    subject: 'Your submission is pending review',
    text: "Thanks for your submission! It's now in our moderation queue and will be reviewed shortly.",
    html: "<p>Thanks for your submission! It's now in our moderation queue and will be reviewed shortly.</p>",
  };
}
