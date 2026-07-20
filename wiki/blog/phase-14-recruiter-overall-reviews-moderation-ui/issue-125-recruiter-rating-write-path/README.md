# Phase 14, Issue #125 — RecruiterInteraction + RecruiterRating Write Path

*Part of Phase 14 — Recruiter & Overall Reviews + Moderation Admin UI.
See `docs/ROADMAP.md` Phase 14.*

## Why this came first

`recruiter_interactions` and `recruiter_ratings` had existed as schema —
tables, constraints, migrations, Prisma models — since Phase 1. Nothing
had ever written a row into either. `ModerationService.review()` threw
`NotImplementedException` for any entity type except `round_rating`,
and `company_recruiter_aggregates` (the Phase 4 materialized view) was
*permanently* empty — not "below the shrinkage floor," but a view over
a table with zero rows possible. The analytics dashboard's "recruiter
experience" section had been rendering "Not enough reviews yet" since
the day it was built, and could never render anything else.
`docs/ARCHITECTURE.md`'s "Known gaps" section had flagged this as the
single biggest hole in the core entity hierarchy; when app-feature work
resumed after Phase 13, this was the obvious first target.

## Key concept: recruiter identity is resolved, never submitted

A candidate rating their recruiter knows the recruiter's name or email —
but CLAUDE.md hard constraint #1 (a deliberate defamation-risk
mitigation, not an oversight) says real recruiter names must never be
exposed publicly. The design that satisfies both:

- The client submits a free-text `recruiterIdentifier` (name and/or
  email) purely as a *de-duplication key*.
- The server HMAC-hashes it (same pepper and normalization as candidate
  email hashing from Phase 2 — a second pepper for one more PII-adjacent
  field would add no real separation) and finds-or-creates a `Recruiter`
  row keyed on `(company_id, internal_identifier_hash)`.
- A new recruiter gets a generated, company-scoped label — "Recruiter
  A", "Recruiter B" — which is the *only* identity that ever leaves the
  API.

The raw identifier is never persisted, never logged, never returned.
The manual verification proved this at the database level: after
submitting an interaction for `Jordan Recruiter <jordan@acme.example>`,
the `recruiters` row contained only a 64-hex-char hash and the label
"Recruiter A".

## Key concept: find-or-create needs a unique constraint to not be a race

The obvious implementation — `findFirst` by hash, `create` if missing —
has a race window: two concurrent submissions naming the same recruiter
can both see "not found" and both insert. Phase 5 hit the same class of
bug with OpenSearch index creation (D16's check-then-act race, surfaced
by parallel Jest workers). The fix here is structural: a new migration
adds `@@unique([companyId, internalIdentifierHash])` on `recruiters`,
which makes the second concurrent insert fail loudly (409 via the
Phase 2 `PrismaExceptionFilter`) instead of silently duplicating the
recruiter — the same reason `candidates.email_hash` has been unique
since Phase 1. This was the phase's only schema change, and per
CLAUDE.md hard constraint #5 it shipped as a Prisma migration, not ad
hoc SQL.

## System design approach

Three new `api` modules, each doing one thing:

```
recruiters/               # no controller — internal identity resolution only
  recruiters.service.ts   #   findOrCreate(companyId, identifier, tx)
recruiter-interactions/   # POST /processes/:processId/recruiter-interactions
recruiter-ratings/        # POST /recruiter-interactions/:id/ratings
                          # GET  /recruiter-interactions/:id/ratings (approved only)
```

The rating write is a verbatim copy of the Phase 3 shape: the
`RecruiterRating` row (status `pending`, hard constraint #2) and its
`moderation_queue` entry are created in the same transaction, so a
rating can never exist without a queue entry. `ModerationService.
review()` gained a `recruiter_rating` branch flipping the rating's
status alongside the queue entry — `overall_review` stayed
`NotImplementedException` for issue #126. Two things were explicitly
scoped *out*: fraud checks (D13's `FraudChecksService` is
round_rating-specific today) and review-search indexing (D17's index
stays round_rating-only until something asks otherwise).

## Step-by-step: what actually got built

1. **The migration first** — the unique constraint on `recruiters`,
   applied and verified against the local Postgres before any service
   code depended on the compound-key upsert lookup existing.
2. **`RecruitersService.findOrCreate()`** with the hashing util and
   sequential label generation (`Recruiter ${String.fromCharCode(65 +
   priorCount)}`), plus unit tests including one that asserts the
   created row's `internalIdentifierHash` matches `/^[0-9a-f]{64}$/`
   and never contains the raw identifier.
3. **The two write modules**, wired into `AppModule`, mirroring
   `round-ratings/` down to the DTO validation style.
4. **The moderation extension** — including updating the existing spec
   that had used `recruiter_rating` as its "not implemented yet"
   example; that test now belonged to `overall_review`.
5. **7 e2e tests** (`recruiter-ratings.e2e-spec.ts`) against real
   Postgres: pending → enqueued → approve → publicly visible;
   reject stays hidden; duplicate (same candidate, same interaction)
   409; unknown process 404; invalid payload 400.
6. **Live curl verification** of the whole loop against the dev server,
   ending with a direct database check that only the hash and label
   were stored.

## What this enabled — and what the verification accidentally found

The recruiter half of the analytics dashboard can now, for the first
time, actually accumulate data. Issue #126 finished the pattern for
`overall_review`, and issue #127 gave both write paths a UI.

The verification also surfaced something unplanned: the "check the
database directly" step initially queried the *wrong Postgres*. The
machine was running Postgres.app (a standalone macOS Postgres, nothing
to do with this repo) bound to the same `127.0.0.1:5432` that Docker
Compose published — and `psql`/the dev server had been silently talking
to it. That discovery led to consolidating all local Postgres usage
onto the kind cluster's instance (docs/DECISIONS.md D24, later extended
to OpenSearch in D26) — a reminder that end-to-end verification pays
for itself in ways that have nothing to do with the feature being
verified.
