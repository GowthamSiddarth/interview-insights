# Phase 17, Issue #260 — Deleting a Process That Never Went Anywhere

*Phase 17 was declared fully done, then reopened while live-verifying
Phase 24's issue #247. See `docs/ROADMAP.md` Phase 17 and
`docs/DECISIONS.md` D46.*

## Why this surfaced during unrelated work

Live-verifying issue #247's rating-field redesign meant actually using
the wizard end to end: create a company, start a process, add a round,
submit a rating with the new field names. Checking the result on `/me`
afterward — the same page this project always checks last, since it's
the one place a candidate sees their own content regardless of
moderation status — surfaced something unrelated to the fields
themselves: several processes sitting there with a round attached but
no rating, showing "No ratings submitted for this process yet."
forever. Nothing on that page offered a way to remove them.

## Key concept: this isn't issue #150 reopened, it's a different question

Issue #150 (Update/Delete under moderation-safe rules) had already
made a deliberate call: structural entities — `InterviewProcess`,
`Round`, `RecruiterInteraction` — stay out of scope for edits and
deletes, permanently. That reasoning holds up completely on its own
terms: #150 exists to stop an edit from quietly undermining the
moderation gate, and a structural entity has no moderation status to
undermine in the first place.

But "should editing a structural entity be allowed" and "should a
person's own empty, abandoned data be stuck forever with no cleanup
path" are two different questions. The first one #150 already answered
correctly. This issue is the second one, and it hadn't been asked yet
— not because anyone missed it, but because it only becomes visible
once you actually abandon a wizard flow partway through and then go
look at `/me`, which is exactly what happened while verifying #247.

## Key concept: "empty" has to mean something narrow and unambiguous

The obvious risk in a delete feature scoped to "empty" processes is
scope creep — what counts as empty enough? The answer here is
deliberately strict: zero round ratings, zero recruiter ratings, no
overall review, **across every status**, pending included. A
still-`pending`, unmoderated rating is real content — it just hasn't
been reviewed yet, which is exactly the property `/me` exists to
surface (issue #149: "the one place you can see a rating before it's
approved"). Letting a candidate delete a process because its only
rating happens to still be pending would quietly destroy something
real. The check only passes when there is, genuinely, nothing there.

## System design approach

```ts
async remove(id: string, candidateId: string): Promise<void> {
  const process = await this.prisma.interviewProcess.findUniqueOrThrow({
    where: { id },
    include: {
      rounds: { include: { ratings: true } },
      recruiterInteractions: { include: { ratings: true } },
      overallReview: true,
    },
  });
  if (process.candidateId !== candidateId) {
    throw new ForbiddenException('You can only delete your own process.');
  }

  const hasAnyContent =
    process.rounds.some((r) => r.ratings.length > 0) ||
    process.recruiterInteractions.some((ri) => ri.ratings.length > 0) ||
    process.overallReview !== null;
  if (hasAnyContent) {
    throw new ConflictException(
      'This process has at least one rating or review and cannot be deleted.',
    );
  }

  await this.prisma.$transaction(async (tx) => {
    await tx.round.deleteMany({ where: { processId: id } });
    await tx.recruiterInteraction.deleteMany({ where: { processId: id } });
    await tx.interviewProcess.delete({ where: { id } });
  });
}
```

Same ownership pattern `RoundRatingsService.remove()` already
established (issue #150): a 404 for a process that doesn't exist or
isn't visible, a distinct 403 for one that exists but belongs to
someone else, and a 409 — not a 403 — when the process is real,
owned, and simply not empty, since that's a different kind of refusal
than an ownership mismatch. No `moderation_queue` cleanup is needed
here at all: an empty process, by definition, never had anything
enqueued against it in the first place.

On `/me`, the fix is almost entirely subtractive: the existing "No
ratings submitted for this process yet." message — already the exact
signal that a process qualifies — just grows a "Delete process" button
next to it, gated by the same `window.confirm` pattern every other
delete on that page already uses.

## Step-by-step: what actually got built and verified

1. Filed as its own issue (#260) under Phase 17's epic (#183),
   reopening it — the same non-linear reopening precedent Phase 18/20
   already established, since Phase 17's actual completion long
   predated this finding.
2. `InterviewProcessesService.remove()` + a new `DELETE /processes/:id`
   route; `EmptyProcessNotice` component on `/me`, replacing the
   plain empty-state text with the same text plus a delete button.
3. New unit tests covering the ownership check and every "not empty"
   variant (a pending round rating, a recruiter rating, an overall
   review) each independently blocking the delete.
4. New `delete-empty-process.e2e-spec.ts` (401/404/403/409/204 against
   real Postgres) plus two new component tests on `/me` (confirmed
   delete, declined confirmation).
5. Full suite green: 265 api unit tests, 111 e2e tests, the
   golden-path smoke test, 67 web tests.
6. Rebuilt and rolled out the real `api`/`web` images. Live-verified in
   a real headless browser through the actual Ingress-fronted app:
   created a fresh process, abandoned it after adding a round,
   confirmed the delete button appeared and worked; separately
   confirmed a process with a real submitted rating never shows the
   button at all. Zero console errors either way.
7. Directly cleaned up the actual leftover rows the original report
   was about, plus (found along the way) one more orphaned
   moderation-queue entry the verification pass itself left behind —
   the exact same class of gap D44 already documented, from approving
   a rating outside the real moderation flow during manual testing.

## What this enabled

A person's own `/me` page no longer accumulates permanent, empty
clutter from an abandoned attempt — with a narrow enough definition of
"empty" that nothing real can ever be lost through it. Phase 26's
client-side draft wizard will eventually make this scenario rare (an
abandoned draft won't reach the database at all), but this closes the
gap immediately rather than waiting, and stays useful for whatever
Phase 26 doesn't fully prevent.
