# Project: Interview Insights Platform

Candidates rate their interview experience per-round (difficulty, fairness,
interviewer traits) plus their recruiter interactions, rolled up into
company-level analytics dashboards. Think "Glassdoor for interview loops,"
but with structured per-round data instead of just free text.

Read `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, and `docs/DECISIONS.md`
before making structural changes — they contain reasoning you should not
re-litigate without a good reason.

## Core entity hierarchy
```
Company
  └── InterviewProcess (one candidate's application loop)
        ├── Round (phase, title, type, interviewer, description)
        │     └── RoundRating (difficulty, fairness, interviewer traits)
        ├── RecruiterInteraction
        │     └── RecruiterRating (approachability, response time, timeliness)
        └── OverallReview (summary review for the whole process)
```
Full schema: `docs/DATA_MODEL.md`.

## Hard constraints — do not violate without asking first

1. **Never expose real interviewer/recruiter names publicly.** They're stored
   as internal entities (for de-duplication and internal analytics) but shown
   publicly only as a generated label ("Interviewer A", "Round 2 recruiter").
   This is a deliberate defamation-risk mitigation, not an oversight.
2. **Every review/rating write goes through moderation before it's public.**
   `status` starts at `pending` on all rating/review tables. Fraud and spam
   prevention are core to this product, not a later add-on.
3. **Public aggregate scores use shrinkage, never a raw average shown as-is.**
   See the formula in `docs/DATA_MODEL.md` under Aggregation layer. Never
   display a score below `n = 3` samples — return `null` and let the frontend
   show "not enough reviews yet."
4. **One rating per candidate per round/interaction.** Enforced via unique
   constraints in the schema — don't relax this without a specific reason.
5. **Migrations are the source of truth for schema.** Never hand-edit
   production schema directly. Every schema change is a Prisma migration.

## Stack (decided)

| Layer | Choice |
|---|---|
| ORM / migrations | Prisma |
| Primary DB | PostgreSQL |
| Cache | Redis |
| Search | OpenSearch |
| Event bus | Kafka (or Redpanda locally) |
| Analytics store | Postgres materialized views → ClickHouse if/when volume demands it |
| Frontend | Next.js + Tailwind |
| API framework | NestJS (Node/TypeScript) — see D10 in docs/DECISIONS.md |
| Container/orchestration | Docker Compose (local) → Kubernetes (deployed) |
| Cloud provider (Phase 8+, not yet built) | AWS — see D11 in docs/DECISIONS.md |

See `docs/ARCHITECTURE.md` for how these pieces connect and why.

## Conventions

- Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`).
- Every new endpoint needs: unit test, integration test (real Postgres via
  Docker), and an OpenAPI/schema doc update.
- Schema changes always start as a Prisma migration file, never ad hoc SQL.
- Don't add new round-type-specific columns to `rounds` — use the
  `type_metadata` JSONB field (see `docs/DATA_MODEL.md` for examples).
- **Plan a phase before implementing any of it.** Before writing code for a
  new `docs/ROADMAP.md` phase, break it into GitHub issues (with a milestone)
  covering the whole phase first — same pattern used for Phase 3 (issues
  #1-#3 filed together before any of them were implemented). Implementation
  starts only after that planning pass is done; see
  `wiki/github-project-setup.md` for the `gh` commands.
- **Always branch + PR, never commit directly to `main`.** Applies to every
  change, including documentation-only or workflow-convention updates like
  this one — there's no carve-out for changes that don't touch application
  code.

## Build order (see docs/ROADMAP.md for full detail)

1. Repo scaffold + Prisma migrations for core entities
2. Thin vertical slice: one company → process → round → rating, end to end
3. Testing setup (unit + integration)
4. CI (lint/test/build on PR)
5. Moderation queue as its own worker/service
6. Aggregation materialized views + analytics endpoint
7. Containerize all services, docker-compose for local dev
8. k8s manifests (local kind/minikube first, then staging overlay)

## Current status

*Update this section at the end of every working session — this is the
single most useful thing to keep current.*

As of 2026-07-16: Phase 1 (repo scaffold), Phase 2 (thin vertical slice),
Phase 3 (trust & moderation), Phase 4 (analytics), and Phase 5 (search &
discovery) are all done. Phase 6 is done except issue #18 (blocked).

**Phase 1** — repo layout matches `docs/ARCHITECTURE.md`: `api/` (NestJS),
`web/` (Next.js + Tailwind), `workers/` (placeholder, no logic yet), `infra/`
(docker-compose.yml runs Postgres only — Redis/Redpanda/api/web all removed
from it, see D9/D12; `k8s/base`, `k8s/overlays/{dev,staging,prod}`,
`terraform/` are empty placeholders until Phase 7), `.github/workflows/ci.yml`.
Prisma schema
(`api/prisma/schema.prisma`) implements every table in `docs/DATA_MODEL.md`
in the documented migration order, plus the first migration
(`api/prisma/migrations/20260714000000_init`). The 1-5 CHECK constraints on
rating columns aren't expressible in Prisma schema language, so they're
appended as raw SQL at the end of that migration file. Aggregation
materialized views are intentionally NOT in schema.prisma — they'll be raw
SQL in a dedicated migration when Phase 4 starts.

**Phase 2** — Create + Read (scope decision: Update/Delete deferred until
there's auth to gate who can call them, and rating/review edits after
submission would undermine the moderation model anyway) for the full
Company → InterviewProcess → Round → RoundRating chain, plus a Candidates
endpoint (dependency for InterviewProcess — email is hashed server-side with
an HMAC pepper, `EMAIL_HASH_SECRET`, and the raw email is never persisted).
Global `PrismaExceptionFilter` maps unique/FK/not-found Prisma errors to
409/422/404. 38 unit tests (DTO validation + email-hash + Candidate service
logic) and integration e2e tests against a real Postgres (unique-constraint
conflict, moderation gate, validation edge cases) all pass. Minimal Next.js
wizard drives the whole flow; verified by actually running both servers and
driving it with a headless-Chromium (Playwright) script — this caught a real
bug (NestJS doesn't enable CORS by default, so every browser fetch from
`web` to `api` failed preflight even though curl-based checks looked fine)
now fixed via `app.enableCors()` + `CORS_ORIGIN` env var. `api`/`web` build +
lint + test clean; `workers` typechecks.

**Phase 3, issue #1 (moderation queue)** — a `ModerationModule` in `api`
(not a separate worker — see D12): `RoundRatingsService.create()` inserts a
`moderation_queue` row in the same transaction as the rating; `POST
/moderation/queue/:id/{approve,reject,flag}` transitions both the queue
entry and the underlying rating's status; `GET /moderation/queue` lists
unreviewed entries. Only `round_rating` is wired up (the only entity type
with a write path so far) — `recruiter_rating`/`overall_review` raise
`NotImplementedException` until those exist. 14 new unit tests + a dedicated
`moderation.e2e-spec.ts` (12 e2e tests total now) prove the full loop against
a real Postgres: submit → enqueued pending → approve → now publicly visible
via the Phase 2 `GET /rounds/:roundId/ratings` endpoint; also covers
reject/flag staying hidden, double-review conflicting (409), and a
not-found entry (404). GitHub issue #1 tracked via `wiki/github-project-setup.md`'s
workflow — milestone "Phase 3 — Trust & moderation", issues #1-#3 on the
Board.

**Phase 3, issue #2 (fraud checks)** — a `FraudChecksService` in a new
`fraud-checks/` module: rate-limits a candidate to 3 ratings per rolling
24h window, and flags exact-match (case/whitespace-normalized) duplicate
`free_text` across any existing rating. Neither ever blocks the write —
both only attach a `flagReason` (`rate_limit`/`duplicate`) to the
moderation_queue entry `RoundRatingsService.create()` already creates; see
D13 for why (and its known scaling limits — duplicate detection is a
full-table scan, fine at today's volume only). 7 new unit tests +
`fraud-checks.e2e-spec.ts` (15 e2e tests total now) prove both checks trip
correctly against a real Postgres without ever rejecting the write.

**Phase 3, issue #3 (candidate verification)** — a new
`candidate-verification/` module plus a `CandidateVerificationToken` table
(migration `20260716032724_add_candidate_verification_tokens`):
`POST /candidates/:id/verification-token` issues a single-use, 24h-expiring,
hashed token (issuing a new one supersedes any still-valid one for that
candidate); `POST /candidates/verify` consumes it and flips
`verificationStatus` to `email_verified`. No email is actually sent — the
token is returned directly in the response, a deliberate temporary gap, see
D14. 12 new unit tests + `candidate-verification.e2e-spec.ts` (20 e2e tests
total now) prove the full issue → verify → `email_verified` loop, plus
reuse/unknown-token/expiry rejections, against a real Postgres. Along the
way, fixed a real bug in `fraud-checks.e2e-spec.ts`: it used fixed literal
`free_text` strings, which collided with leftover rows from earlier runs
against the same persistent Docker Postgres volume and made the "distinct
text isn't flagged" assertion flaky — fixed by making the text unique per
run, same pattern already used for slugs/emails elsewhere in the suite.

Phase 3 is now fully done — all three GitHub issues (#1-#3) closed via
merged PRs. All `api` unit + e2e tests, build, and lint pass.

**Phase 4 planning** — before any implementation, filed all four of
Phase 4's issues under a "Phase 4 — Analytics" milestone (issues #7-#10,
each noting its dependency on the previous), per the new CLAUDE.md
convention: plan a whole phase before implementing any of it.

**Phase 4, issue #7 (materialized views)** — raw SQL migration (not
`schema.prisma` — Prisma doesn't manage views) adding the three views from
`docs/DATA_MODEL.md`: `company_round_type_aggregates`,
`company_recruiter_aggregates`, `company_overall_aggregates`. All three
aggregate `status = 'approved'` rows only, and each has a unique index on
its grain columns so a future `REFRESH ... CONCURRENTLY` won't lock
readers out. No refresh trigger exists yet — deferred to issue #9, see D15.
`company_recruiter_aggregates`/`company_overall_aggregates` are
schema-correct but will stay empty until `recruiter_ratings`/
`overall_reviews` get a write path (still not built — same caveat already
noted for `ModerationService`). 4 new integration tests
(`aggregation-views.e2e-spec.ts`, 24 e2e tests total now) prove all three
views compute correctly against a real Postgres, including that a
zero-approved group produces no row at all (not a row of nulls/zeros).

**Phase 4, issue #8 (shrinkage scoring)** — a new `analytics/` module (no
controller yet, that's issue #9): `computeShrinkageScore()` is a pure
function implementing the D4 formula (`k = 8` default, hard floor
`n < 3` → `null`); `GlobalAveragesService` computes platform-wide averages
per metric from the issue #7 materialized views, weighted by each
company's own `sample_size` (mathematically identical to averaging every
raw approved rating directly, without re-scanning the raw tables) — returns
`null` when there's no platform data yet for that slice (cold start).
Scope note: the "fall back to the company-wide aggregate when a
round-type slice is under the floor" behavior from `docs/DATA_MODEL.md`
belongs to issue #9 (it decides which aggregate to feed the formula), not
this one. 15 new unit tests (formula boundary conditions + service parsing
logic, mocked Prisma) plus 2 new integration tests
(`global-averages.e2e-spec.ts`, 26 e2e tests total now) prove the weighted
global average matches hand-computed values against real multi-company
data, and correctly returns `null` for a round type with no data at all.

**Phase 4, issue #9 (`GET /companies/:companyId/analytics`)** — a new
`AnalyticsService`/`AnalyticsController` in `analytics/` (now wired into
`AppModule`, since the module finally has a controller): fetches a
company's own rows from all three issue #7 materialized views, shrinkage-
scores each metric against issue #8's `GlobalAveragesService` +
`computeShrinkageScore()`, and returns every score alongside its real
`sample_size` — always, even when the score itself is `null` below the
floor (D4: transparency, not a hidden gate). Round types the company has
never been rated on simply don't appear (the view itself excludes
zero-sample groups); `recruiter`/`overall` are `null` when the company has
no rows in those views at all. Scope note carried over from issue #8: the
"fall back to company-wide when a round-type slice is under the floor"
nuance from `docs/DATA_MODEL.md` is deferred, not implemented — not
required by this issue's acceptance criteria, and adds real complexity
without evidence it's needed yet. 5 new unit tests (mocked Prisma +
`GlobalAveragesService`) plus 5 new integration tests
(`analytics.e2e-spec.ts`, 31 e2e tests total now) prove the endpoint
against real Postgres, including a hand-recomputed shrinkage value, the
null-with-real-sample_size case, empty responses, and 404/400s. Also
manually verified end-to-end: booted the api against the Docker Postgres,
drove real HTTP calls through the actual write → moderation-approve →
refresh-view → analytics-read loop via curl, and confirmed the returned
score matched the shrinkage formula's expected pull toward the
platform-wide average.
- Next step: Phase 4 issue #10 (dashboard UI), per `docs/ROADMAP.md` — the
  last item in Phase 4.

**Phase 4, issue #10 (dashboard UI)** — a new page,
`web/src/app/companies/[companyId]/analytics/page.tsx`, fetching issue #9's
endpoint and rendering three sections: overall experience, per-round-type
breakdown, recruiter experience. A reusable `ScoreDisplay` component
(`web/src/components/ScoreDisplay.tsx`) centralizes the null-handling rule
(CLAUDE.md hard constraint #3): a `null` score always renders "Not enough
reviews yet", never `0`/blank, and the real `sample_size` is always shown
alongside it — even when the score itself is null. Reachable from the
Phase 2 wizard via a "View analytics dashboard" link once a company is
selected. 3 new component tests (`score-display.spec.tsx`) cover the
null/non-null/singular-"review" branches. Manually verified in a real
browser (Playwright): seeded a company with a deliberate mix (one round
type well above the shrinkage floor, one below it, plus an
under-the-floor recruiter and overall review), and confirmed the
dashboard renders real numbers for the scored slice and "Not enough
reviews yet" exactly 11 times (5 behavioral metrics + 4 recruiter + 2
overall) everywhere else, with zero console errors; also confirmed the
wizard's dashboard link navigates to the right company correctly.

**Phase 4 is now fully done** — all four GitHub issues (#7-#10) closed via
merged PRs. `api` and `web` both build/lint/test clean.

**Phase 6 hardening, issue #17 (full-stack Docker Compose)** — fixed a
latent bug in `api/Dockerfile`: its runtime stage ran `npm ci --omit=dev`
(dropping the `prisma` CLI, a devDependency) then still called `npx prisma
generate`, silently relying on npx auto-installing the CLI over the
network. Fixed per Prisma's own documented pattern — copy the built
`node_modules` wholesale from the build stage instead of reinstalling.
Also fixed `web/Dockerfile` trying to copy a `public/` directory that
didn't exist (added `web/public/.gitkeep`). `api`'s container now runs
`prisma migrate deploy` automatically before starting. `infra/
docker-compose.yml` gained `api`/`web` back behind a `full` Compose
profile — default `docker compose up` still just Postgres (fast dev loop
unchanged), `docker compose --profile full up --build` gives the complete
containerized stack. Verified three ways: (1) built + ran the full profile
against the existing dev Postgres, confirmed `/health` and a real browser
flow through the containerized web talking to the containerized api with
zero console errors; (2) ran the `api` image against a genuinely fresh,
empty Postgres in an isolated container to prove all 3 migrations apply
correctly from a clean state, not just a no-op; (3) `npm run build`,
`lint`, `test` all still pass natively in both `api` and `web`.

**Phase 6 hardening, issue #18 (branch protection)** — blocked, not done.
Both classic branch protection (`PUT .../branches/main/protection`) and the
newer repository rulesets API (`POST .../rulesets`) return 403 "Upgrade to
GitHub Pro or make this repository public" for private repos on the free
plan — confirmed directly via both endpoints, not an assumption. Left open
on GitHub (with the blocker documented in an issue comment) rather than
closed; revisit if/when the account upgrades to Pro or the repo's
visibility changes. The branch+PR discipline (CLAUDE.md convention) still
applies day to day regardless — this issue was specifically about
*platform-enforcing* it, which isn't available yet.

**Phase 5 planning** — before any implementation, filed all three of
Phase 5's issues under a "Phase 5 — Search & discovery" milestone
(issues #21-#23, each depending on the previous), per the "plan a phase
before implementing" convention. Included a search UI issue in this pass
(user's call — the original `docs/ROADMAP.md` bullets didn't list one).

**Phase 5, issue #21 (OpenSearch + company search)** — `infra/
docker-compose.yml` gained an `opensearch` default service (single-node,
security plugin disabled for local dev) — the first real trigger to add
it, per D9. A new `search/` module (`@opensearch-project/opensearch`
client): `CompanySearchService` indexes a company into a `companies`
index synchronously, in-process, right after `CompaniesService.create()`'s
Postgres write — but best-effort (wrapped in try/catch, logged not
thrown), since OpenSearch is a derived/secondary store, not the source of
truth (D16). `GET /search/companies?q=` does a multi-match search over
`name`/`slug` (no fuzziness — see issue #22's notes below on why that was
removed). Found and fixed a real concurrency bug while building this:
`onModuleInit`'s original check-then-act index creation
(`indices.exists` then `indices.create`) raced when multiple app
instances started concurrently (surfaced immediately by parallel Jest
workers in the e2e suite; would also hit multiple replicas in a real
deployment) — fixed by always attempting creation and swallowing the
resulting `resource_already_exists_exception`. 9 new unit tests (mocked
OpenSearch client — index creation/race-swallowing, indexing, search
result mapping) plus 4 new integration tests (`company-search.e2e-spec.ts`)
against a real OpenSearch + Postgres prove a created company is
searchable within the same request cycle, ranks a closer name match
above a looser one, and returns an empty array (not an error) for no
matches.

**Phase 5, issue #22 (review search with faceted filtering)** — extends
`ModerationService.review()`: approving a `round_rating` now also indexes
it into a new `reviews` OpenSearch index (companyId, roleTitle, roundType,
freeText, createdAt, scores — never `candidateId`, CLAUDE.md hard
constraint #1), after the DB transaction commits, best-effort, same
pattern as D16 (see D17). `GET /search/reviews?q=&companyId=&roleTitle=
&roundType=&dateFrom=&dateTo=` combines a free-text match on `freeText`
with facet filters. Extracted the shared "swallow
resource_already_exists_exception" logic (D16) into
`opensearch-errors.util.ts` now that two services need it.

Found and fixed two more real bugs while building this:
- **`roleTitle` filter used `match` instead of `match_phrase`** — `match`'s
  per-token OR semantics meant filtering for "Staff Engineer X" also
  matched "Product Manager X" purely because they shared token X. An e2e
  test caught this directly (not flaky — deterministically wrong).
- **`fuzziness: 'AUTO'` on `CompanySearchService`'s query (D16) was a
  latent relevance bug**, not something specific to issue #22: two long
  numeric tokens a few digits apart (e.g. two `Date.now()`-based
  identifiers) could fuzzy-match each other. Looked exactly like a flaky
  e2e test at first — it wasn't; it was a deterministic false-positive
  match that only *appeared* random because it depended on how close two
  independently-generated random numbers landed. Removed fuzziness from
  that query. Also bumped `test/jest-e2e.json`'s `testTimeout` to 30s
  (from Jest's 5s default) — `beforeAll` hooks booting a full Nest app
  plus Postgres *and* OpenSearch connections measurably exceeded 5s under
  heavy repeated local test runs. Both are documented in D17.

11 new unit tests (mocked OpenSearch client + `ModerationService` wiring)
plus 7 new integration tests (`review-search.e2e-spec.ts`, 43 e2e tests
total now) against real Postgres + OpenSearch prove: an approved review is
searchable/filterable; pending and rejected reviews never appear; each
filter (roleTitle, roundType, date range) narrows results correctly, both
individually and combined; an invalid `roundType` is rejected (400).
Stress-tested the full e2e suite ~25 times while chasing the above bugs to
confirm both fixes actually resolve what looked like flakiness, rather
than assuming a passing run was enough.

**Phase 5, issue #23 (search UI)** — a new page,
`web/src/app/search/page.tsx`: step 1 searches companies via issue #21's
`GET /search/companies?q=`; selecting one reveals step 2, which filters
that company's reviews via issue #22's `GET /search/reviews` (role title,
round type, date range, individually or combined). A reusable
`EmptyState` component (`web/src/components/EmptyState.tsx`) renders an
explicit "no results" message for both steps — a zero-result search must
never look identical to "haven't searched yet" or "still loading."
Reachable from the Phase 2 wizard homepage via a "Search companies &
reviews" link. 1 new component test (`search-page.spec.tsx`) covers the
company empty-state path. Manually verified in a real browser
(Playwright): seeded a company plus 3 approved reviews (2 role
titles, 3 round types) directly via Prisma/OpenSearch (bypassing the API,
since moderation approval for 3 rows one at a time is tedious) and drove
all 7 steps — company empty state, company found, review selection,
unfiltered results (3/3), round-type filter narrowing to exactly 1 result,
and a no-match filter empty state — with zero console errors. This caught
a real bug in the *seed script*, not the app: the script created the
company via raw Prisma, which skips `CompaniesService.create()`'s
OpenSearch indexing call entirely (since that only runs through the API
layer), so the company was never searchable — the seed script now also
indexes the company directly, mirroring the manual review-indexing it
already did.

**Phase 5 is now fully done** — all three GitHub issues (#21-#23) closed
via merged PRs. `api` and `web` both build/lint/test clean.
- Next step: no explicit next phase requested yet. Phase 6 remainder
  (issue #18, branch protection) is blocked on GitHub plan limits; Phase 7
  (Kubernetes) and Phase 8 (production hardening menu) are the next
  unstarted roadmap items — wait for direction before planning either.

## Open decisions still to make

- Exact value of `k` in the shrinkage scoring formula (start at 8, tune later)
- Retention/deletion policy for moderation queue + rejected content (GDPR
  erasure path)
- Whether/when to slice `company_overall_aggregates` by role or level
