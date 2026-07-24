# Phase 17, Issue #151 — GDPR Erasure Path

*Part of Phase 17 — Candidate Self-Service. Depends on issue #150 (shares
its cascade machinery — `removeQueueEntries()`/`removeReview()`). See
`docs/ROADMAP.md` Phase 17 and `docs/DECISIONS.md` D34.*

## Why this closes the oldest open decision in the project

"Retention/deletion policy for moderation queue + rejected content" had
sat in this project's "Open decisions" list since Phase 1 — a
long-standing gap, not a new requirement. `DELETE /me` is the concrete
answer: a candidate can ask for their account and everything it
touched to be permanently gone, and the platform actually does that,
verifiably.

## Key concept: delete, don't anonymize

A lot of erasure designs anonymize-in-place — replace a row's
identifying fields with placeholders, keep the row (and its foreign
keys) intact, so downstream aggregates and referential integrity don't
need to change. This project didn't need that pattern, for a reason
specific to how it was built from Phase 1 onward: no raw candidate
identity is stored anywhere to begin with. `Candidate.emailHash` is an
HMAC, never the raw email (docs/DATA_MODEL.md's very first design
principle). And the public aggregates a candidate's approved content
feeds — `company_round_type_aggregates` and friends — are already
de-identified statistics, out of GDPR scope once computed, and they
simply recompute correctly the next time they refresh once the
underlying rows are gone. There was nothing here that needed a
tombstone row to stay consistent. A hard delete is simpler, and it was
the right call, not a shortcut.

## Key concept: structural entities *are* in scope here — unlike issue #150

Issue #150's Update/Delete drew a clean line: content types
(`RoundRating`/`RecruiterRating`/`OverallReview`) only, never
`InterviewProcess`/`Round`/`RecruiterInteraction`. This issue reaches
all of them anyway, and that's not a contradiction — it's answering a
different question. #150 was about whether *editing an opinion*
post-submission undermines moderation. This issue is about whether a
person's data can persist after they ask for it to be gone — and
`InterviewProcess.candidateId` is a required, non-nullable foreign key
with no `onDelete: Cascade` in `schema.prisma`. A process cannot exist
without a candidate owning it; Prisma's schema doesn't even permit
deleting the candidate first and leaving the process behind (it would
23503 on the FK constraint). So erasure has to walk the whole tree.

## Key concept: deletion order is the whole implementation

```ts
async eraseMe(candidateId: string): Promise<void> {
  const [roundRatings, recruiterRatings, overallReviews, processes] = await Promise.all([
    this.prisma.roundRating.findMany({ where: { candidateId }, select: { id: true, status: true } }),
    this.prisma.recruiterRating.findMany({ where: { candidateId }, select: { id: true } }),
    this.prisma.overallReview.findMany({ where: { candidateId }, select: { id: true } }),
    this.prisma.interviewProcess.findMany({ where: { candidateId }, select: { id: true } }),
  ]);
  // ...gather ids, then in one $transaction:
  //   moderation_queue entries for all three entity types (no FK, gathered by id list)
  //   RoundRating / RecruiterRating / OverallReview  (reference Candidate, Round/RecruiterInteraction)
  //   Round / RecruiterInteraction                   (reference InterviewProcess)
  //   InterviewProcess                                (references Company, Candidate)
  //   CandidateVerificationToken                      (references Candidate)
  //   Candidate                                        (last)
}
```

Every table must have its rows removed before any other table still
holding a foreign key to them. Get the order wrong — say, delete
`InterviewProcess` before its `Round`s — and Postgres rejects the
delete outright with a constraint violation, not a silent partial
success. `moderation_queue` is the one exception: it has no FK at all
(a deliberate polymorphic reference, `docs/DATA_MODEL.md`), so its
cleanup is order-independent — but it still needs to happen, since
nothing else would ever clean it up. This reuses the same idea issue
#150 introduced with `removeQueueEntries()`, just batched by an array
of ids gathered up front instead of one entity at a time.

## Key concept: the shared `Recruiter` row is the one thing that must never move

`Recruiter` rows are per-company internal identity, used for
de-duplication and referenced by potentially many different
candidates' `RecruiterInteraction`s (CLAUDE.md hard constraint #1).
Erasing a candidate must delete *their own* `RecruiterInteraction`
rows without ever touching the `Recruiter` row those interactions
point at — otherwise erasing one candidate could silently break
another candidate's still-live review of the same recruiter. This
isn't a hypothetical edge case: `gdpr-erasure.e2e-spec.ts` proves it by
actually creating two candidates against the same company with the
same recruiter identifier, confirming they resolve to the same shared
`Recruiter` row, erasing one candidate, and asserting the other
candidate's interaction, rating, and the shared row all survive
untouched.

## Key concept: stateless sessions need an explicit existence check

Phase 16 chose stateless JWT cookies for candidate sessions — no
server-side revocation list. That design is fine until an account can
just cease to exist mid-session, which erasure introduces for the
first time. Without a check, a token issued before `DELETE /me` (still
sitting in a second device, or just not yet expired) would keep
passing signature/expiry verification and reach a route handler, which
would then fail downstream — an FK violation, a not-found error — for
a candidateId that simply isn't there anymore.

```ts
async validate(payload: CandidateSessionPayload): Promise<CandidateSessionPayload> {
  const candidate = await this.prisma.candidate.findUnique({ where: { id: payload.candidateId } });
  if (!candidate) {
    throw new UnauthorizedException();
  }
  return { candidateId: payload.candidateId };
}
```

This turns that failure into a clean 401 at the guard, before any
route handler runs — the same category of "distinguish the failure
mode" discipline issue #150 applied to 403-vs-404. The trade-off is
explicit and accepted, not accidental: one extra DB round trip on
*every* authenticated candidate request now, not just erasure-adjacent
ones. `DELETE /me` also clears both session cookies
(`candidate_session`/`candidate_logged_in`) the same way
`POST /auth/logout` does, even though the strategy check alone would
already 401 their next use — there's no reason to leave a
now-meaningless cookie sitting in the browser.

## System design approach

`MeService.eraseMe()` sits alongside `findMySubmissions()` in the same
`me/` module issue #149 built — the read path and the erasure path
share a home because they're answering the same underlying question
("what does this candidate own?"), just for different purposes. On
`web`, a "Danger zone" section at the bottom of `/me` — the same page
that already shows everything erasure is about to delete — with a
`window.confirm`-gated "Delete my account" button, worded explicitly
about scope and irreversibility since this is a much bigger action
than deleting one item. A hard navigation
(`window.location.href = '/'`, not `router.push`) afterward, the same
D32 reasoning as the post-verify redirect: `NavBar` is mounted once in
the root layout and won't otherwise notice the session is gone.

## Step-by-step: what actually got built and verified

1. **`CandidateJwtStrategy.validate()`** made async, injecting
   `PrismaService` and throwing `UnauthorizedException` on a missing
   candidate — 4 unit tests, including the post-erasure 401 case.
2. **`MeService.eraseMe()`** — the full cascade above, 5 new unit
   tests (deletion order, moderation-queue cleanup by id list,
   Recruiter-row exclusion, approved-only search removal) — 250 api
   unit tests total.
3. **`DELETE /me`** (`CandidateJwtAuthGuard`-gated, 204), clearing both
   session cookies.
4. **A new 3-test e2e suite** (`gdpr-erasure.e2e-spec.ts`, 105 e2e
   total) against real Postgres + OpenSearch: a full erasure leaves
   zero rows across every table — verified with direct Postgres
   queries, not just HTTP responses — and both search indices, with
   `company_round_type_aggregates` converging to zero rows for that
   company/round-type on the next refresh; a stale post-erasure
   session gets a clean 401 from a protected route; erasing one
   candidate never touches another candidate sharing the same
   company's `Recruiter` row.
5. **`web/src/app/me/page.tsx`**'s "Danger zone" section, 4 new
   component tests (54 web tests total) covering the section's
   rendering, a confirmed erasure with the hard-navigation redirect,
   and a declined confirmation doing nothing.
6. **Live verification** (real `kind` Postgres/OpenSearch/Mailpit via
   port-forward, real dev servers, headless Chromium): logged in via a
   real magic link, submitted a rating, clicked "Delete my account" on
   `/me`, confirmed the browser landed back on the anonymous homepage
   with `NavBar` showing "Log in" and both session cookies cleared,
   replayed the old session cookie against `GET /me/submissions` and
   got a clean 401, and confirmed directly via `kubectl exec` psql
   that the process/round/rating rows were gone while the company row
   itself — not owned by the candidate — survived untouched. Zero
   console errors throughout.

## Phase 17 is now fully implemented

With #149, #150, and #151 all merged, every issue this phase set out to
close is done: candidates can see their own submissions across every
status, edit or delete their own moderated content without undermining
moderation, and permanently erase their account and everything it
touched. This post (#152) closes the phase's engineering blog.
