// GitHub issue #711 (Phase 49, D104) — extracted out of
// notification-consumer.service.ts so ReconciliationSweepService can
// reuse the exact same approved/rejected copy without duplicating it.
// The two "approved"/"rejected" fixed templates D73 anticipated — never
// called for 'flagged' (see notification-consumer.service.ts's own
// comment for why that's a deliberate no-op) or 'pending' (review()
// never re-emits the status it started from).
export function subjectAndBodyFor(newStatus: 'approved' | 'rejected'): {
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
  return {
    subject: 'Your submission was not approved',
    text: 'Your submission was reviewed and was not approved. Thank you for taking the time to share your feedback.',
    html: '<p>Your submission was reviewed and was not approved. Thank you for taking the time to share your feedback.</p>',
  };
}

// The one fixed template for a *.created event — also reused by
// ReconciliationSweepService (#711) for a missed pending-review email.
export function pendingReviewSubjectAndBody(): { subject: string; text: string; html: string } {
  return {
    subject: 'Your submission is pending review',
    text: "Thanks for your submission! It's now in our moderation queue and will be reviewed shortly.",
    html: "<p>Thanks for your submission! It's now in our moderation queue and will be reviewed shortly.</p>",
  };
}
