import { pendingReviewSubjectAndBody, subjectAndBodyFor } from './notification-templates.util';

describe('subjectAndBodyFor', () => {
  it('returns the fixed approved copy regardless of any extra args', () => {
    const result = subjectAndBodyFor('approved', 'low_quality', 'ignored');

    expect(result.subject).toBe('Your submission has been approved');
    expect(result.text).not.toContain('low quality');
    expect(result.html).not.toContain('low quality');
  });

  it('returns the plain rejected copy when no category/note is given', () => {
    const result = subjectAndBodyFor('rejected');

    expect(result.text).toBe(
      'Your submission was reviewed and was not approved. Thank you for taking the time to share your feedback.',
    );
    expect(result.html).toBe(
      '<p>Your submission was reviewed and was not approved. Thank you for taking the time to share your feedback.</p>',
    );
  });

  // GitHub issue #729 (follow-up to #688, Phase 49).
  it('includes the human-readable category when given', () => {
    const result = subjectAndBodyFor('rejected', 'guideline_violation');

    expect(result.text).toContain('The reason given was: a guideline violation.');
    expect(result.html).toContain('The reason given was: a guideline violation.');
  });

  it('includes the moderator note when given', () => {
    const result = subjectAndBodyFor('rejected', undefined, 'Names a specific interviewer.');

    expect(result.text).toContain('Moderator note: "Names a specific interviewer."');
    expect(result.html).toContain('Moderator note: "Names a specific interviewer."');
  });

  it('includes both category and note together', () => {
    const result = subjectAndBodyFor('rejected', 'spam_or_promotional', 'Links to an unrelated product.');

    expect(result.text).toBe(
      'Your submission was reviewed and was not approved. The reason given was: spam or promotional content. Moderator note: "Links to an unrelated product." Thank you for taking the time to share your feedback.',
    );
  });

  it('treats a null category/note the same as omitted (ReconciliationSweepService never has these on hand)', () => {
    const result = subjectAndBodyFor('rejected', null, null);

    expect(result.text).toBe(
      'Your submission was reviewed and was not approved. Thank you for taking the time to share your feedback.',
    );
  });

  // GitHub issue #729 — reviewNote is moderator-entered free text, the
  // first variable content this file has ever put into an HTML string.
  it('HTML-escapes the note in the html body but not the text body', () => {
    const result = subjectAndBodyFor('rejected', undefined, '<script>alert(1)</script> & "quoted"');

    expect(result.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quoted&quot;');
    expect(result.html).not.toContain('<script>alert(1)</script>');
    expect(result.text).toContain('<script>alert(1)</script> & "quoted"');
  });
});

describe('pendingReviewSubjectAndBody', () => {
  it('returns a first-time-submission subject by default', () => {
    expect(pendingReviewSubjectAndBody().subject).toBe('Your submission is pending review');
  });

  it('returns a resubmission-ack subject when isResubmission is true', () => {
    expect(pendingReviewSubjectAndBody(true).subject).toBe('Your edited submission is back in review');
  });
});
