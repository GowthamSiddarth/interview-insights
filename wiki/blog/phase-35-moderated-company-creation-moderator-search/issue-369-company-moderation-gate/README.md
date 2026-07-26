# Phase 35, Issue #369 — Company Creation Moves Behind Moderation

*Part of Phase 35 — Moderated Company Creation & Moderator Search. See
`docs/ROADMAP.md` Phase 35 and `docs/DECISIONS.md` D58.*

## The gap this closed

`POST /companies` had existed since Phase 1 and had never once gone
through moderation. Every other write path in this app — round
ratings, recruiter ratings, overall reviews — starts `pending` and is
invisible until a moderator approves it (CLAUDE.md hard constraint
#2). Companies were the one exception, and not by any deliberate
design: `Company` has no `candidateId` column, so it was never on
Phase 16's "sessions on the write path" list, and Phase 20's later
lockdown (issue #217, D38) added a session gate and a rate limit but
never touched moderation. The gap sat there, live, until direct user
feedback on issue #360's create-company-request flow surfaced it.

## Key concept: reuse the existing pattern, don't invent a new one

The first real design question was how to represent "a company that's
been requested but not yet approved." The alternative to what shipped
— a separate request record, with the real `Company` row only created
once approved — would have meant duplicating the eventual
company-creation logic and inventing a concept the schema doesn't have
anywhere else. Instead, `Company` gained a `status` column reusing the
*existing* `ModerationStatus` enum, mirroring `RoundRating`/
`RecruiterRating`/`OverallReview` exactly: the row exists the moment
it's created, `status: pending` by default, just invisible to every
public read until a moderator flips it.

```prisma
model Company {
  // ...
  status ModerationStatus @default(pending)
}
```

Every public read path — `findAll()` (the quick-select list),
`findBySlug()` (the profile page), the existence checks backing
`GET /companies/:id/reviews` and `.../analytics` — now filters to
`status: approved`, treating a pending or rejected company exactly like
one that doesn't exist (a 404, never a "yes it's there but not
approved" leak).

## Key concept: indexing moves from creation-time to approval-time

Before this issue, `CompaniesService.create()` indexed the new company
into the public `companies` OpenSearch index synchronously, right after
the Postgres write. That's backwards once creation is pending by
default — indexing now happens from `ModerationService.review()`'s new
`company` case, the exact moment approval actually happens, mirroring
how `indexApprovedReview()` already handles round ratings. Rejecting
never indexes anything at all.

## Key concept: a rejected company keeps its row

The most consequential decision made directly with the project owner:
should a rejected request's row be deleted (freeing its slug for a
future resubmission) or kept for an audit trail? The GDPR-erasure
precedent (D34, "delete, not anonymize") might suggest deletion is this
project's default instinct — but that decision was about a person's own
data disappearing on request, not about preserving a record of what was
reviewed and rejected. The project owner chose to keep the row
(`status: rejected`), explicitly trading away slug reuse for an audit
trail. A rejected company's name/slug stays permanently occupied unless
an admin manually intervenes later — no such intervention path exists
yet, a known, accepted gap.

## Key concept: a friendlier response for a duplicate pending request

A second piece of direct feedback: requesting a name that's already
been requested and is still pending should say so plainly, not surface
Prisma's generic unique-constraint 409. `CompaniesService.create()` now
checks for an existing row by slug before attempting the insert:

```ts
const existing = await this.prisma.company.findUnique({ where: { slug: dto.slug } });
if (existing?.status === 'pending') {
  throw new ConflictException(
    'This company has already been requested and is pending review — please check back later.',
  );
}
```

A duplicate of an **approved** company still falls through to the
generic conflict (the company genuinely already exists); a duplicate of
a **rejected** one is left as the same generic conflict for now — an
explicitly unresolved question, not an oversight, noted directly in the
issue for whenever it needs its own answer.

## A real gap the test suite surfaced: raw-Prisma seeding skips the new default

Sixteen existing e2e specs created a company via a raw `POST /companies`
call and immediately expected it to be usable — every one of them
needed an admin-approve step inserted, via a new shared
`test/support/companies.ts` helper (`createApprovedCompany`/
`createPendingCompany`/`findCompanyQueueEntryId`) rather than
duplicating the create-then-approve dance sixteen times over. One file,
`analytics.e2e-spec.ts`, seeds its test company directly via raw
Prisma, bypassing the API layer (and its default `pending` status)
entirely — the exact same class of gap D51 already found once for
search indexing. Fixed by setting `status: 'approved'` explicitly in
that seed data.

## Step-by-step: what actually got built and verified

1. Prisma migration: `Company.status` (reusing `ModerationStatus`) and
   a fourth `ModerationEntityType` value, `company`.
2. `CompaniesService.create()` enqueues via `ModerationService` instead
   of indexing directly; every public read path gated on
   `status: approved`; the duplicate-pending friendly-conflict check.
3. `InterviewProcessesService.create()` and
   `BulkProcessSubmissionService.create()` both reject a `companyId`
   that isn't approved, with 404.
4. `ModerationService.review()`'s switch extended for `company`;
   `listPending()`'s enrichment extended to surface a company request's
   own fields (slug, size, industry), grouped standalone (no
   `InterviewProcess` to group under) via a synthetic
   `company-request-<id>` key.
5. 12 new/updated api unit tests, 16 existing e2e specs updated, a new
   dedicated `company-moderation.e2e-spec.ts` (7 tests: hidden from
   every read path, process-creation blocked, the rejected-row-kept
   behavior, both duplicate-slug cases) — all green.
6. Live-verified against the real `kind` cluster via curl: a pending
   company hidden everywhere, a duplicate-pending 409 with the friendly
   message, process creation blocked, approval making it visible
   everywhere and searchable, and a rejected company's row confirmed
   still present (`status: rejected`) via direct `kubectl exec` psql.

## What this enabled

Company creation finally matches every other write path's moderation
guarantee — and issues #370-372 (moderator search, its UI, and the
frontend follow-up to the now-wrong auto-redirect) all build directly
on this decision.
