# Project: Interview Insights Platform

Candidates rate their interview experience per-round (difficulty, plus
interviewer traits limited to fluency, clarity, and focus) plus their
recruiter interactions, rolled up into company-level analytics dashboards.
Think "Glassdoor for interview loops," but with structured per-round data
instead of just free text.

Read `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, and `docs/DECISIONS.md`
before making structural changes — they contain reasoning you should not
re-litigate without a good reason.

## Core entity hierarchy
```
Company
  └── InterviewProcess (one candidate's application loop)
        ├── Round (phase, title, type, interviewer, description)
        │     └── RoundRating (difficulty, interviewer traits: fluency/clarity/focus)
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
  **Exception: Phase 8.** It's a trigger-gated menu, not a linear phase —
  see its intro in `docs/ROADMAP.md` for why. Plan (file issues + a
  milestone) one sub-area (8a-8g) at a time, only once that sub-area's own
  trigger fires — never the whole phase's menu upfront.
- **Every phase's planning batch also includes a "write the engineering
  blog for this phase" issue**, filed alongside the phase's feature issues
  during the same planning pass — but implemented *last*, once every other
  issue in the phase is merged, since the post documents the finished
  work. Posts live under `wiki/blog/<phase-slug>/`: one post per GitHub
  issue for phases planned this way, or per logical sub-topic for the
  handful of phases (1-2) that predate the issue/milestone convention.
  Each post covers key concepts, core technologies, infra build steps,
  system design approach, and a step-by-step implementation account — see
  `wiki/blog/README.md` for the index and any existing post for the
  expected depth.
- **Always branch + PR, never commit directly to `main`.** Applies to every
  change, including documentation-only or workflow-convention updates like
  this one — there's no carve-out for changes that don't touch application
  code.
- **Move an issue's board status to "In Progress" the moment work actually
  starts on it** (not when it's filed during planning), and **assign every
  PR to yourself** (`gh pr create --assignee <github-username>`), same as
  issues already are. See `wiki/github-project-setup.md`'s "Workflow
  convention" section for this project's concrete `gh project item-edit`
  IDs.
- **Epics vs Milestones, kept as two distinct concepts.** A phase is an
  **Epic**: a themed, date-less body of work, tracked as a real parent
  issue with the phase's feature issues attached as native GitHub
  sub-issues. The GitHub **Milestone** stays too, but demoted to what
  it's actually good at — a flat, date-less grouping — and is reserved
  to mean a genuine date-bound external commitment only once one
  actually exists (e.g. a real staging-launch date spanning issues from
  more than one phase). Adopted starting Phase 18, then retrofitted onto
  every earlier phase the same day at the project owner's request —
  every phase 1-19 now has a tracking epic issue (docs/ROADMAP.md's
  per-phase "Epic: GitHub issue #N" line has the mapping). See
  `wiki/github-project-setup.md`'s
  "Epics vs Milestones" section for the concrete sub-issues API commands.
- **Only epics go on the Project board, not individual sub-issues** —
  file/milestone/sub-issue every feature issue as usual, but only
  `gh project item-add` the phase's epic. Each sub-issue's own
  implementing PR must still use a real closing keyword (`Closes #N`)
  so it registers as a linked PR, not just a mention — see
  `wiki/github-project-setup.md`'s "Board hygiene" note for how to
  verify that and the archive command used to retrofit this onto the
  board once (162 completed + 17 individual sub-issues archived,
  reversible).

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

As of 2026-07-24: Phase 1 (repo scaffold), Phase 2 (thin vertical slice),
Phase 3 (trust & moderation), Phase 4 (analytics), Phase 5 (search &
discovery), Phase 7 (Kubernetes), Phase 9 (UX/UI Polish Pass),
Phase 10 (Cloud-Readiness Practice, local/free), Phase 11 (Integrated
Prototype: LocalStack Secrets & IAM in kind), Phase 12 (Local CD &
Cluster Observability), Phase 13 (Local Infra Hardening &
Reproducibility), Phase 14 (Recruiter & Overall Reviews + Moderation
Admin UI), Phase 15 (Public Company Profile Pages), Phase 16
(Candidate Accounts & Auth), Phase 17 (Candidate Self-Service), and
Phase 18 (Admin Authentication) are all done. Phase 6 is done except
issue #18 (blocked). Phase 18 was reopened the same day it was first
declared done, once a real login attempt surfaced a Secure-cookie bug
and two follow-up issues (#192 credential rotation, #193
mid-session-expiry redirect, both now done). Phases 1-7, 9-18 each
have a complete engineering blog under `wiki/blog/`. Phase 8 is a
trigger-gated backlog, not started. Phase 16 closed out with issues
#144 (mail foundation, D29), #145 (magic-link auth, supersedes and
removes Phase 3's standalone verification endpoints, D30), #146
(sessions on the write path, four candidateId-bearing writes now
session-gated, `POST /candidates` removed, D31), #147 (login/logout UI
+ wizard integration — session-hint cookie instead of a passive
`GET /auth/me` poll, hard navigation after verify, D32), and #148
(engineering blog, that phase's). Phase 17 closed out with issues #149
(my reviews, grouped by `InterviewProcess`), #150 (Update/Delete under
moderation-safe rules, shared per-candidate edit throttle, D33), #151
(GDPR erasure — `DELETE /me`, delete not anonymize, stale-session 401
via a DB existence check, D34), and #152 (engineering blog, this
phase's). Phase 19 (Content Quality & Synthetic Data) is planned but
not started. Phase 18 was filed after Phase 16-17, but per the same
non-linear precedent Phase 6/8 already set, was implemented first —
see the Phase 18 intro in `docs/ROADMAP.md` for why. Phase 20
(Operational Hardening & Live-Verification Findings) is now also fully
done, filed retroactively, 2026-07-24 — a new standing convention that
every ad-hoc dev/test/structural task gets tracked under an Epic, not
just planned phase work. All 5 issues closed: #215 (CD prune, D35),
#216 (golden-path smoke test, D36), #212 (moderation-queue race fix,
D37), #217 (login-copy + company-creation lockdown, D38), and #218
(engineering blog, this phase's, one post per feature issue under
`wiki/blog/phase-20-operational-hardening/`). Phase 20 jumped ahead of
Phase 19 the same way Phase 18 jumped ahead of 16/17 — the findings
surfaced live, mid-session, rather than through planned-phase work.

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

**Phase 7 planning** — before any implementation, filed all three of
Phase 7's issues under a "Phase 7 — Kubernetes" milestone (issues #27-#29,
each depending on the previous), per the "plan a phase before implementing"
convention: #27 base manifests for the stateful deps (Postgres,
OpenSearch), #28 base manifests for `api`/`web` (Deployment/Service/
Ingress/ConfigMap, depends on #27's in-cluster Service DNS), #29 Kustomize
overlays for dev/staging/prod (depends on #27+#28 existing first; staging/
prod overlays are structural only until Phase 8's networking/secrets
triggers actually fire — only `dev` gets deployed as part of that issue).
Helm explicitly out of scope for all three, per docs/ARCHITECTURE.md, until
manifests are "genuinely repetitive" — not the case with 2-3 services yet.
`workers/` still has no manifest — it's still a no-logic placeholder.

**Phase 7, issue #27 (stateful-dependency manifests)** — `infra/k8s/base/`
gained numbered manifests (ordering matters for `kubectl apply -f dir/`:
namespace must land before anything referencing it) — `00-namespace.yaml`,
`01-postgres-secret.yaml` (plaintext `Secret`, acceptable for local-only
kind/minikube — real secret management is gated on Phase 8b's trigger),
`02-opensearch-config.yaml`, `03-postgres.yaml`, `04-opensearch.yaml`.
Both Postgres and OpenSearch are StatefulSets (stable identity + a
`volumeClaimTemplates` PVC each) fronted by headless Services, mirroring
`infra/docker-compose.yml`'s image/env/healthcheck values exactly so
issue #28's `api` config only has to swap hostnames.
Found and fixed two real bugs while building this, neither hit by the
Docker Compose setup because Compose doesn't reproduce either condition:
- **Postgres wouldn't `initdb` at the PVC mount root** — a fresh PVC's
  root can contain filesystem-reserved entries (e.g. `lost+found`), which
  `initdb` refuses to initialize into. Fixed by pointing `PGDATA` at a
  subdirectory of the mount (`/var/lib/postgresql/data/pgdata`), the
  standard workaround.
- **OpenSearch failed to start** with "max virtual memory areas
  vm.max_map_count [65530] is too low" — most container hosts default
  below what OpenSearch/Elasticsearch require. Fixed with a privileged
  `initContainer` (`sysctl -w vm.max_map_count=262144`) ahead of the main
  container, the same pattern OpenSearch's own k8s docs use.
Also set OpenSearch's container memory limit (1536Mi) well above its
`-Xmx512m` JVM heap — the heap is only part of a node's real memory
footprint, and a limit too close to heap size risks an OOMKill under real
indexing load.
Manually verified against a local `kind` cluster (`kind create cluster
--name interview-insights`): both StatefulSets reach `1/1 Running`, PVCs
`Bound`; port-forwarded to each and confirmed `psql`/`_cluster/health`
connectivity; deleted the `postgres-0` pod and confirmed a row inserted
beforehand was still present after the StatefulSet recreated it — proving
the PVC (not `emptyDir`) is what's actually persisting data. Documented
the `kind` workflow in the root `README.md` as an alternative to Docker
Compose for local dev.
**Phase 7, issue #28 (`api`/`web` manifests)** — `infra/k8s/base/` gained
`05-api.yaml` (ConfigMap + Secret + Service + Deployment), `06-web.yaml`
(Service + Deployment), `07-ingress.yaml` (a single nginx `Ingress` with
two host rules — `app.interview-insights.local` → `web`,
`api.interview-insights.local` → `api` — host-based rather than
path-based routing, to avoid an nginx rewrite-target annotation and keep
`NEXT_PUBLIC_API_URL` a plain origin). `api-secrets`' `DATABASE_URL`
duplicates issue #27's Postgres credentials as one connection string —
Kubernetes has no native way to compose an env var out of several Secret
keys, and a wrapper entrypoint just to avoid the duplication isn't worth
it at local-dev scale.

Found and fixed a real bug while building this, pre-existing since issue
#17 but only surfaced by needing an API origin other than `localhost:3001`:
**`web`'s `NEXT_PUBLIC_API_URL` was set as a Docker Compose runtime env
var, but Next.js inlines `NEXT_PUBLIC_*` vars into the client bundle at
*build* time** — the compose setting was a silent no-op, masked only
because `web/src/lib/api.ts`'s hardcoded fallback (`localhost:3001`)
happened to match. Fixed by adding a `NEXT_PUBLIC_API_URL` build `ARG` to
`web/Dockerfile` and moving `infra/docker-compose.yml`'s full profile to
set it via `build.args` instead of `environment`. The `api`/`web` k8s
images are therefore built directly with `docker build` (not through
compose) so each can take its own `--build-arg` matching its target
Ingress host — `kind load docker-image` loads them into the cluster.

Manually verified against a local `kind` cluster recreated with the
ingress-ready node config (`kubeadmConfigPatches` node-label +
`extraPortMappings` for 80/443 — a plain `kind create cluster` doesn't
route external traffic in) plus the kind-specific `ingress-nginx` deploy
manifest: both Deployments reach `1/1 Ready`; `curl --resolve` against
both Ingress hosts (no `/etc/hosts` edit) confirms routing; and a full
Playwright run through the *actual* Ingress-fronted `web` — create
company → candidate/process → round → rating (submitted `pending`, per
CLAUDE.md hard constraint #2) → search finds the just-created company via
the in-cluster `opensearch` Service DNS — passed with zero console
errors, including CORS succeeding now that `CORS_ORIGIN` matches the real
browser origin (`http://app.interview-insights.local`) rather than
`localhost`.
**Phase 7, issue #29 (Kustomize overlays)** — `infra/k8s/base/` gained a
`kustomization.yaml` listing every base manifest; each of
`infra/k8s/overlays/{dev,staging,prod}/` got a real `kustomization.yaml`
in place of its placeholder `.gitkeep`. `dev` is close to a no-op by
design — it's the exact config issues #27/#28 already built and verified,
now formalized as an overlay (own `environment: dev` label) rather than
applying `infra/k8s/base/` directly — and it's the only overlay actually
applied to a real cluster as part of this issue, per the issue's own
acceptance criteria. `staging`/`prod` are structural only (own namespace,
2 replicas for `api`/`web` only — Postgres/OpenSearch stay single-replica,
since scaling either is a real replication-topology change out of scope
here — real-ish resource requests/limits, per-environment Ingress hosts
+ matching `CORS_ORIGIN`, and distinct image tags), gated on Phase 8's
real triggers before either ever runs against a real cluster. Used
Kustomize's newer `labels:` field with `includeSelectors: false` rather
than the older `commonLabels`, specifically because `commonLabels` also
rewrites `spec.selector.matchLabels` — which is immutable on an
already-created Deployment/StatefulSet, and `dev`'s whole point is to be
safely re-appliable over the exact resources issues #27/#28 already
created. Verified concretely, not just assumed: applied `dev` over the
live cluster and confirmed zero pod restarts (proving it was a true
no-op besides labels), and re-confirmed `web`/`api /health` both still
respond through the Ingress afterward. `kubectl kustomize` on all three
overlays produces valid, genuinely-differing output (namespace, labels,
replicas, resource values, Ingress hosts, image tags), satisfying the
issue's acceptance criteria directly.

**Phase 7 is now fully done for its planned scope** — issues #27-#29 all
closed via merged PRs (Helm remains explicitly out of scope per
`docs/ARCHITECTURE.md`, until manifests are "genuinely repetitive," not
the case with 2-3 services). `wiki/blog/phase-7-kubernetes/` now has a
post for all three issues — Phase 7's blog is complete.

**Phase 10 (Cloud-Readiness Practice, local/free)** — both issues (#65,
#66) closed via merged PRs: Helm-installed `ingress-nginx` on the local
`kind` cluster, plus LocalStack-backed IAM policy validation and Secrets
Manager integration, all free/local practice for Phase 8's eventual real
AWS work (see D19/D20 in `docs/DECISIONS.md`). `wiki/blog/
phase-10-cloud-readiness-practice/` has a post for both issues — Phase
10's blog is complete.

**Phase 9 (UX/UI Polish Pass)** — all five issues (#57-#61) closed via
merged PRs: dev-note/copy cleanup, persistent shared navigation, wizard
company-change without a reload, a visual design pass (`PageContainer`/
`Button` components, one indigo accent color), and a loading-vs-empty-
states investigation that surfaced a real React 19 finding (D21:
`<form action={fn}>` defers pre-await `setState` calls until an `await`
resolves; use plain `onSubmit` when an in-flight indicator must render
before any async work starts). `wiki/blog/phase-9-ux-ui-polish/` has a
post for all five issues — Phase 9's blog is complete.

**Phase 11 (Integrated Prototype: LocalStack Secrets & IAM in kind)** —
filed after the user asked, before any Phase 8 planning, whether
everything built so far (Helm, Kustomize, Postgres, OpenSearch, search,
moderation, analytics, secrets/IAM) actually runs together anywhere, or
just each in isolation. An audit found the honest answer was no —
Phase 10's LocalStack work was practice-only (D20) and had never run
near the `kind` cluster. All three issues (#78-#80) closed via merged
PRs: LocalStack (IAM + Secrets Manager) now deploys into `kind` via an
opt-in `dev-localstack` overlay (#78); `api`'s boot path assumes an IAM
role via STS and fetches its real secrets from LocalStack before
`NestFactory.create` runs, opt-in and otherwise unchanged (#79); and an
adversarial end-to-end verification (#80) — deliberately corrupting the
plaintext k8s Secret to prove `api` doesn't silently still depend on it
— caught a real bug: the container's `CMD` ran `prisma migrate deploy`
as a separate shell step that never saw the bootstrapped secrets, fixed
with `api/scripts/entrypoint.js` and documented as D22. That same issue
re-ran the full golden path (company → process → round → rating →
moderation approve → analytics → search) through the real
Helm-ingress-fronted `web` app with zero console errors.
`wiki/blog/phase-11-integrated-prototype/` has a post for all three
issues — Phase 11's blog is complete, and every phase built so far now
has a complete engineering blog.

**Phase 12 planning (Local CD & Cluster Observability)** — filed after
the user asked how to get real CD and cluster visibility given the
local machine is the only hosting target right now: a self-hosted
runner + CD workflow, plus k9s/metrics-server for cluster monitoring.
Distinct from Phase 8a/8f (neither of those triggers has fired) — see
`docs/ROADMAP.md` Phase 12 intro. Milestone "Phase 12 — Local CD &
Cluster Observability", issues #88-#91 filed together.

**Phase 12, issue #88 (self-hosted runner)** — registered on-demand
(`./run.sh`, not a persistent service — smaller standing attack surface
since nothing repo-triggered executes on this machine unless a session
explicitly starts the runner). Verified with a manual
`workflow_dispatch` smoke test (`.github/workflows/self-hosted-smoke-test.yml`);
also fixed an unrelated pre-existing local kubeconfig issue
(`current-context` was unset) the verification happened to surface.

**Phase 12, issue #89 (CD workflow)** — `.github/workflows/cd.yml`:
real `on: push: branches: [main]` trigger (not `workflow_dispatch`),
scoped to `api/**`/`web/**`/`infra/k8s/**` via a `paths` filter, `runs-on:
self-hosted`, executing the build → `kind load` → `kubectl apply -k` →
`rollout restart` sequence from `wiki/deployment-guide.md` section 4.
Verified with a real merge (#95): the push queued the job automatically,
starting the on-demand runner picked it up, and `GET /health`'s `version`
field matched the merge commit SHA exactly after rollout — confirming
the cluster ran the new code, not just that the workflow reported
success.

**Phase 12, issue #99 (dev-localstack wired into CD)** — not part of
the original four-issue planning batch; filed mid-phase after the user
asked to have local secrets/IAM (Phase 11) actually back every local
deploy, not stay an occasional manual opt-in. `cd.yml` now targets
`infra/k8s/overlays/dev-localstack`: provisions the
`localstack-credentials` k8s Secret from a new `LOCALSTACK_AUTH_TOKEN`
GitHub Actions repo secret (before the overlay creates the LocalStack
pod, since its `secretKeyRef` env var doesn't hot-reload), waits for
LocalStack ready, reseeds its secrets/IAM role via the existing
idempotent `infra/aws/seed-localstack.sh`, then rolls out `api`/`web` as
before. Reverses D22's "CD stays on plain `dev`" default — recorded as
D23, including why this doesn't retrigger a real Phase 8b/8d trigger
(still solo local `kind`, no real AWS account). Verified with a real
merge: every step ran clean, and a test candidate's stored `email_hash`
matched an HMAC computed with the LocalStack-seeded secret value, not
the plaintext k8s Secret's — proving `api` is genuinely reading from
LocalStack, not just reachable-but-unused.

**Phase 12, issue #90 (k9s + metrics-server)** — `metrics-server`
Helm-installed into `kube-system` (third-party infra, same D19 pattern
as `ingress-nginx`), with the well-known `--kubelet-insecure-tls` patch
`kind`'s self-signed kubelet certs need. `k9s` installed locally via
`brew install k9s`, no manifests of its own. Verified against the real
cluster: `kubectl top nodes`/`kubectl top pods -n interview-insights`
both return real CPU/memory numbers, and `k9s` itself confirms
"Kubernetes connectivity OK" against the live cluster. Documented in
`wiki/deployment-guide.md` section 3.6. Explicitly not a full
observability stack (Prometheus/Grafana/Loki/Jaeger stay gated on
Phase 8f's own trigger) — scoped to lightweight local tooling only.

`wiki/blog/phase-12-local-cd-cluster-observability/` has a post for all
four feature issues (#88, #89, #90, #99 — #99 wasn't part of the
original planning batch but got a post alongside the three that were).
**Phase 12 is now fully done** — issues #88-#91 all closed via merged
PRs, and every phase built so far now has a complete engineering blog.

**Phase 13 planning (Local Infra Hardening & Reproducibility)** — filed
after the user asked, having just finished Phase 12, what other
infra-side possibilities existed before resuming app-feature work. An
audit (distinct from Phase 8, which stays trigger-gated and untouched)
found three real, local-only gaps: CI never validates `infra/k8s/**` or
either Dockerfile (a broken manifest merges green, only fails later
against the real cluster); the `kind` cluster has run continuously since
Phase 7 with nobody proving it still bootstraps cleanly from empty; and
rebuilding it today means manually replaying several
`wiki/deployment-guide.md` sections by hand. Milestone "Phase 13 — Local
Infra Hardening & Reproducibility", issues #106-#109 filed together.

**Phase 13, issue #106 (CI validation for infra manifests and
Dockerfiles)** — a new `infra` job in `.github/workflows/ci.yml`
(GitHub-hosted, no cluster or self-hosted runner needed): `kubectl
kustomize` against all four overlays (`dev`, `dev-localstack`,
`staging`, `prod`), plus a build-only `docker build` for both
Dockerfiles. Previously a broken manifest or Dockerfile merged with a
green CI check and only failed later, against the real cluster — this
catches both classes of regression at PR time. Verified directly: this
issue's own PR was the first real run of the new job, and it passed.
Documented in `wiki/deployment-guide.md` section 8.

**Phase 13, issue #107 (one-shot local bootstrap script)** —
`infra/scripts/bootstrap-kind.sh` covers `wiki/deployment-guide.md`
section 3 end to end (cluster create, Helm installs for `ingress-nginx`
+ `metrics-server`, image build/load, namespace + LocalStack secret,
overlay apply, seed, roll out `api`), idempotent throughout (cluster-
exists guard, `helm upgrade --install`, `kubectl apply`). Verified by
running it twice back to back against the real already-running
cluster — both runs succeeded, exercising the skip/upgrade paths
directly, with the app confirmed reachable and healthy afterward.
Documented as section 3's new fast path, manual walkthrough kept
underneath as reference.

**Phase 13, issue #108 (adversarial verification: rebuild from
scratch)** — deleted the real, multi-day-old `kind` cluster
(`kind delete cluster`) and rebuilt it from nothing using issue #107's
script — not just re-testing against an already-running cluster, the
way every earlier Phase 11/12 verification had. Found a real bug: on a
genuinely fresh cluster, `api` crash-looped with
`ResourceNotFoundException` because the script waited on every pod
(including `api`) before LocalStack was seeded, but `api`'s entrypoint
needs LocalStack's secrets to boot at all — a deadlock invisible in
every prior test since none of them ever restarted `api` from zero.
Fixed by waiting only on `postgres`/`opensearch`/`localstack`/`web`
before seeding, then explicitly rolling `api` out after — matching the
ordering `cd.yml` already had right. Re-ran the full rebuild after the
fix: all 5 pods `Ready`, both PVCs `Bound`, the complete golden path
(company → candidate → process → round → rating → moderation approve
→ analytics → search) verified through the real Ingress-fronted
`web`/`api`, and the same `email_hash` HMAC comparison from issue #99
confirming `api` genuinely reads from LocalStack post-rebuild.
Documented as a gotcha in `wiki/deployment-guide.md` section 3.

`wiki/blog/phase-13-local-infra-hardening/` has a post for all three
feature issues (#106, #107, #108). **Phase 13 is now fully done** —
issues #106-#109 all closed via merged PRs, and every phase built so
far now has a complete engineering blog.

**Phase 14 planning (Recruiter & Overall Reviews + Moderation Admin
UI)** — filed after the user asked to resume app-feature development
now that infra is stable, and to brainstorm ideas first. Recommended
closing the biggest known app-side gap (`RecruiterRating`/
`OverallReview` have had schema since Phase 1 but zero write path,
leaving two-thirds of the Phase 4 analytics dashboard permanently
empty) bundled with a moderation admin UI (moderation is curl-only
today, even for `round_rating`) — user agreed. Milestone "Phase 14 —
Recruiter & Overall Reviews + Moderation Admin UI", issues #125-#129
filed together per the "plan a phase before implementing" convention.

**Phase 14, issue #125 (RecruiterInteraction + RecruiterRating write
path)** — three new `api` modules mirroring the Phase 3 pattern:
`recruiters/` (no controller — `RecruitersService.findOrCreate()`
resolves a recruiter by HMAC-hashing a candidate-supplied identifier
with the existing `EMAIL_HASH_SECRET` pepper, generating a sequential
per-company "Recruiter A"/"Recruiter B" label; raw identifier never
persisted, hard constraint #1), `recruiter-interactions/` (`POST
/processes/:processId/recruiter-interactions`), and
`recruiter-ratings/` (`POST /recruiter-interactions/:id/ratings`,
moderation-gated in the same transaction, plus the approved-only public
GET). `ModerationService.review()` extended to flip `recruiter_rating`
status. New migration adds `@@unique([companyId,
internalIdentifierHash])` on `recruiters` so identity resolution is a
safe upsert. Fraud checks and review-search indexing explicitly out of
scope (D13's checks are round_rating-specific). 15 new unit tests + 7
e2e tests (`recruiter-ratings.e2e-spec.ts`); verified live end to end
via curl (submit → pending → approve → publicly visible) including
confirming in Postgres that only the hash + label are stored.

**Interlude: two real incidents found while verifying #125.** (1) The
manual verification's psql check went to the wrong database — the
machine also ran Postgres.app, a standalone macOS Postgres bound to the
same `127.0.0.1:5432` the Compose Postgres published, silently
intercepting connections. User decision: one Postgres only — kind's.
Native dev + local e2e now port-forward to `postgres-0`; local e2e
targets a separate `interview_insights_test` database on that instance;
Compose's `postgres` service stays in the file as inert reference only;
user deleted Postgres.app (D24). (2) `api` had been crash-looping for
~9h: LocalStack's pod restarted and, having no PVC by design (#78),
lost all seeded secrets — fixed structurally by mounting a seed script
into `/etc/localstack/init/ready.d/` (LocalStack's lifecycle-hooks
mechanism) so it self-reseeds on every start, including unplanned
restarts; verified adversarially by deleting the LocalStack pod and
rolling `api` with zero manual seeding (D25). Gotcha recorded in D25:
Kustomize `configMapGenerator` output doesn't inherit a namespace —
without an explicit `namespace:` in the localstack kustomization the
ConfigMap silently landed in `default` and the volume mount failed.

**Phase 14, issue #126 (OverallReview write path)** — a new
`overall-reviews/` module, same shape: `POST
/processes/:processId/overall-review` (singular path — one review per
process, the schema's `UNIQUE(process_id)` surfaces duplicates as 409
via `PrismaExceptionFilter`, no app logic) plus an approved-only public
GET returning the single review or empty. No migration needed — table
and constraint have existed since Phase 1. With all three entity types
now writable, `ModerationService.review()`'s `NotImplementedException`
guard is deleted; the status flip is an exhaustive switch over
`ModerationEntityType`. 12 new unit tests + 7 e2e tests
(`overall-reviews.e2e-spec.ts`, 57 e2e total); e2e ran against kind's
Postgres per D24 (port-forward + `interview_insights_test`), and the
live curl golden path (submit → 409 duplicate → empty public read →
approve → visible) was confirmed landing in kind's `postgres-0` via
`kubectl exec` psql directly.
**Phase 14, issue #127 (wizard: recruiter + overall review steps)** —
two new sections on the Phase 2 wizard (`web/src/app/page.tsx`), gated
on a round existing: "5. Recruiter experience" (identifier + 4 rating
fields + optional free text — creates the interaction then the rating
in sequence; the identifier field says explicitly it's never shown
publicly) and "6. Overall review" (experience 1-5, would-recommend
checkbox, optional text — form disappears after submission, matching
`UNIQUE(process_id)`). Both confirmations show the real `pending`
status, mirroring the round-rating step. `web/src/lib/api.ts` gained
the three types + client methods. 3 new component tests
(`recruiter-overall-steps.spec.tsx`, route-based fetch mock driving
the full wizard; 14 web tests total). Verified in a real headless
browser (Playwright) against the api dev server backed by kind's
Postgres per D24: full 6-step flow, both submissions confirmed
`pending` in the moderation queue via direct API check, zero console
errors.
**Interlude: OpenSearch consolidation (D26)** — the user spotted the
two-OpenSearch split (Compose container + the in-cluster StatefulSet
inside the kind node container) and asked to consolidate, extending
D24's "one server only" to OpenSearch. Native dev + local e2e now
port-forward to kind's `opensearch`; the Compose service stays inert
reference. The wrinkle Postgres didn't have: OpenSearch has no database
concept, so a new `OPENSEARCH_INDEX_PREFIX` env var
(`api/src/search/search-index-name.util.ts`, default empty — CI and
deployed environments unchanged) isolates local e2e into
`e2etest-companies`/`e2etest-reviews`. Verified with a before/after doc
count on the real indices across a full e2e run (2/1 → 2/1, all churn
in `e2etest-*`). Also that day: two dangling `<none>` Docker images
explained (untagged old `api:k8s`/`web:k8s` builds) and pruned, and a
manual CD-equivalent deploy run by hand when a GitHub Actions incident
(expired TLS cert on the Actions broker host — diagnosed from the
runner's `_diag` logs + `openssl s_client`, confirmed on
githubstatus.com) blocked the self-hosted runner from picking up the
queued job.

**Phase 14, issue #128 (moderation admin UI)** — a new
`web/src/app/moderation/page.tsx` (linked from the shared NavBar):
lists pending queue entries across all three entity types with
approve/reject/flag actions (flag reason selectable per entry, optional
moderator name applied to all actions), explicit loading vs
"Queue is clear" empty state (issue #61's rule). API side:
`ModerationService.listPending()` now enriches each entry with its
entity's own fields + display context (company, role, round,
generated recruiter label) server-side — pending entities are
deliberately unreadable via every public endpoint, so the UI had no
other way to show what it's moderating; one query per entity type per
page, never per entry; `internal_identifier_hash` and `candidateId`
never cross the wire. 2 new unit tests + 5 component tests + an
enriched-entity e2e assertion (167 api unit / 19 web / 57 e2e, all
green — e2e stress-run 5x against kind's stores per D24/D26 after one
non-reproducible first-connection port-forward hiccup). Verified in a
real browser (Playwright): seeded one pending entry per entity type,
drove approve (round rating) / reject (recruiter rating) / flag
(overall review, spam_pattern) through the real page, confirmed all
three transitions + moderator name + flag reason directly in kind's
Postgres via `kubectl exec` psql, zero console errors, and asserted the
raw recruiter identifier appears nowhere in the rendered page.
`wiki/blog/phase-14-recruiter-overall-reviews-moderation-ui/` has a
post for all four feature issues (#125-#128). **Phase 14 is now fully
done** — issues #125-#129 all closed via merged PRs, and every phase
built so far has a complete engineering blog.
**Phases 15-17 planning** — at the user's explicit request (a
deliberate deviation from the one-phase-at-a-time cadence), all three
next phases were planned in one pass after the post-Phase-14
brainstorm: Phase 15 (Public Company Profile Pages, issues #140-#143),
Phase 16 (Candidate Accounts & Auth — magic links subsuming D14's
verification gap, issues #144-#148), Phase 17 (Candidate Self-Service —
my-reviews, Update/Delete closing Phase 2's deferral, GDPR erasure
closing the oldest open decision, issues #149-#152). Implementation
stays strictly sequential. See docs/ROADMAP.md Phases 15-17.
**Phase 15, issue #140 (company read paths)** — `GET
/companies/by-slug/:slug` (profile pages address companies by slug,
unique since Phase 1; two-segment route so it can't collide with
`:id`) and `GET /companies/:id/reviews` (approved-only round ratings
joined with round title/type + role title, paginated via a
`page`/`pageSize` query DTO — the codebase's first `@Type()` coercion,
which needed an explicit `reflect-metadata` import in its bare unit
test). Reads Postgres, not OpenSearch (D16/D17: derived index, a
profile page is a source-of-truth read); verifies company existence
first (404, not an empty page); `candidateId` never included
(unit-asserted). README's API endpoint table was still labeled "Phase
2 slice" — refreshed to cover every endpoint through Phase 15. 9 new
unit tests + 5 e2e tests (`company-reviews.e2e-spec.ts`, 62 e2e
total) against kind's stores per D24/D26, plus live curl verification
against real data (slug 200/404, shaped items, no candidateId).
**Phase 15, issue #141 (company profile page)** — a new
`web/src/app/companies/[slug]/page.tsx`: header (name, industry, size
bucket) + shrinkage-scored aggregates (overall experience, by-round-
type breakdown, reusing `ScoreDisplay`) + a paginated approved-reviews
list, with loading/empty states distinguished throughout (Phase 9
issue #61). Real routing constraint hit immediately: the pre-existing
analytics dashboard lived at `/companies/[companyId]/analytics`, and
Next.js's App Router refuses two differently-named dynamic segments at
the same path level (`companyId` vs `slug`) — confirmed via `next dev`
actually erroring at startup, even though `next build` stayed silent
about it. Fixed by moving analytics to `/companies/[slug]/analytics`
too (resolving slug → id client-side before calling the existing
analytics endpoint) and updating the wizard's link
(`company.id` → `company.slug`). Both pages also switched from the
`params`-as-Promise + `use()` pattern to `useParams()` — synchronous,
no Suspense boundary needed, and the change that actually made the new
page's component tests possible (a bare RTL `render()` doesn't get App
Router's automatic Suspense wrapper the Promise pattern depends on).
5 new component tests (`company-profile-page.spec.tsx`, 24 web tests
total). Verified in a real browser (Playwright) against dev servers
backed by kind's stores per D24/D26: seeded a company with 3 approved
round ratings + 1 approved overall review, confirmed the round-type
breakdown showed real shrinkage-scored numbers once
`REFRESH MATERIALIZED VIEW` ran (D15 — no auto-refresh trigger exists
yet, a pre-existing, already-documented gap, not new), confirmed the
overall-experience section correctly showed "Not enough reviews yet"
with its real `1 review` sample size (n=1, below the shrinkage floor —
exactly hard constraint #3's transparency rule), navigated to the
slug-based analytics link and back, zero console errors throughout.
**Phase 15, issue #142 (entry points to the profile page)** — the
wizard link had already landed as a side effect of issue #141 (same
file touched for the analytics slug-rename); this issue added the
remaining two. `web/src/app/search/page.tsx`: each company search
result row gets a "View profile" link alongside its existing
select-for-filtering button (kept as two separate affordances, not
merged, since selecting a company is a different action from leaving
the page), and the review-filtering step's header gets a "(view
profile)" link once a company is selected. The analytics page gets a
"Back to company profile" link, closing the loop issue #141 opened
one-directionally. 3 new component tests (2 in
`search-page.spec.tsx`, 1 new `company-analytics-page.spec.tsx` file —
the analytics page had never had one; 29 web tests total). Verified in
a real browser (Playwright): full loop search → profile (via the
result-row link) → analytics (via the profile link) → back to profile
(via the new back-link), zero console errors. Phase 15 is now fully
done — all three feature issues (#140-#142) merged.
`wiki/blog/phase-15-company-profile-pages/` has a post for all three
feature issues (#140-#142). **Phase 15 is now fully done** —
issues #140-#143 all closed via merged PRs, and every phase built so
far has a complete engineering blog.

**Phase 18/19 planning (Admin Authentication; Content Quality &
Synthetic Data)** — filed 2026-07-20 after a strategic "how do we move
toward enterprise-grade" review covering infra, CI/CD, security, auth,
spam control, review-analysis accuracy, synthetic data, and cluster
hosting options (OCI Always Free considered as a real staging target
alongside/instead of AWS). The review surfaced that the Phase 14
moderation admin surface has zero authentication today — both
`ModerationController` and `web/src/app/moderation/page.tsx` say so in
their own comments — which is safe only as long as everything stays on
localhost/kind, and becomes a real hole the moment any environment is
reachable by anyone else. That's urgent enough to jump ahead of the
already-planned Phase 16/17, mirroring the non-linear precedent Phase
6/8 already established (later-numbered phases proceeding while an
earlier one sits open/gated). Milestones "Phase 18 — Admin
Authentication" (issues #159-161) and "Phase 19 — Content Quality &
Synthetic Data" (issues #162-165) filed together per the "plan a phase
before implementing" convention. See `docs/ROADMAP.md` Phases 18-19 for
full scope. Epics vs Milestones (see Conventions) then got adopted from
this planning pass onward and retrofitted onto every earlier phase the
same day — Phase 18 → epic #167, Phase 19 → epic #168.

**Phase 18, issue #159 (admin auth backend)** — a new `admin-auth/`
module in `api` (`@nestjs/passport` + `passport-local` + `passport-jwt`
+ `@nestjs/jwt`, `bcryptjs` for the credential hash — pure-JS, not
native `bcrypt`, so the existing `node:22-slim` Dockerfile stages don't
need build tooling added just for this). Single shared admin credential
via `ADMIN_USERNAME`/`ADMIN_PASSWORD_HASH` env vars, same plain-env-var
pattern as `EMAIL_HASH_SECRET` (dev k8s Secret; not wired into the
LocalStack secrets bootstrap, which stays scoped to
`DATABASE_URL`/`EMAIL_HASH_SECRET` only). `POST /auth/admin/login` sets
a short-lived (1h) JWT as an httpOnly `admin_session` cookie — never
returned in the JSON body; `POST /auth/admin/logout` clears it,
deliberately left unauthenticated itself since its only effect is
clearing a cookie and gating it would break clearing an
already-expired session. `AdminJwtAuthGuard` applied at the controller
level on `ModerationController` — every route (list/approve/reject/flag)
401s without a valid session. Login is throttled by a new
`LoginThrottleService` (in-memory, per-IP, 5 attempts/15min) sitting in
front of the credential check via guard ordering
(`@UseGuards(LoginThrottleGuard, AdminLocalAuthGuard)`), so a throttled
IP never reaches `bcrypt.compare()` — same category of known
single-instance limitation as D13's fraud-check scaling caveat, fine at
today's solo-`kind` scale. `main.ts` gained `cookie-parser` middleware
(needed for the JWT strategy to read the session cookie) and
`app.enableCors({ credentials: true })` (needed for the cookie to
survive cross-origin at all) — both required updating every e2e spec
that calls a moderation route (`moderation`, `fraud-checks`,
`overall-reviews`, `recruiter-ratings`, `review-search`,
`company-reviews`), via a new shared `api/test/support/admin-session.ts`
helper (`loginAsAdmin()`) rather than duplicating login logic six times.
21 new unit tests (service/guard/strategy, mocked) + 8 new e2e tests
(`admin-auth.e2e-spec.ts`, 73 e2e total now) prove: valid/invalid
login, cookie-gated moderation access, logout actually invalidates
(re-attaching the cleared cookie still 401s), and the rate limit trips
— that last one against its own freshly-booted app instance so its
attempt count doesn't compete with the file's earlier login calls.
Manually verified live via curl against a locally-run `api` (kind's
Postgres/OpenSearch via port-forward, per D24/D26): no cookie → 401,
wrong credentials → 401, correct login → 200 + `Set-Cookie` with
`HttpOnly`, authenticated call → 200, logout → 200, reused
post-logout cookie → 401, and 3 wrong-password attempts followed by a
429. `web/src/app/moderation/page.tsx` is now broken against a real
deployment until issue #160 (frontend login + route gating) lands —
expected and in scope for that issue, not this one; it still works
fine locally since nothing has redeployed it yet.
**Phase 18, issue #160 (admin auth frontend)** — a small backend
addition first: `GET /auth/admin/me` (guarded by `AdminJwtAuthGuard`,
returns the session payload or 401), giving `web` a lightweight way to
ask "am I logged in?" up front rather than discovering it via a failed
data call. Along the way, fixed a real bug the strategy hadn't hit
until something actually read its return value end to end:
`AdminJwtStrategy.validate()` was passing through the decoded JWT
payload unchanged, which includes `jwt.sign()`'s own `iat`/`exp`
claims — harmless for the guard itself (only used for pass/fail) but
wrong for `/me`, which returns that value directly and should match
`AdminSessionPayload` exactly. Now narrowed to `{ username }` only.
On `web`: a new `web/src/app/moderation/login/page.tsx` (username/
password form, posts to issue #159's login endpoint, redirects to
`/moderation` on success, shows a status-specific error — "incorrect
username or password" for 401, "too many attempts" for 429 — and
stays put on failure). `web/src/app/moderation/page.tsx` now checks
`GET /auth/admin/me` before rendering anything and redirects to the
login page on 401, rather than rendering the queue and then failing
individual calls; gained a "Log out" button in its header (calls
`POST /auth/admin/logout`, then redirects to login regardless of
whether that call itself succeeds — the goal is always getting back
to the login screen). Fixed a real bug in `web/src/lib/api.ts`'s
shared `request()` helper while wiring this up: it never set
`credentials: 'include'` on `fetch()`, so the `admin_session` cookie
would have been silently dropped on every cross-origin call between
`web` and `api` — issue #159's `enableCors({ credentials: true })`
alone isn't sufficient, the client has to opt in too. 6 new unit tests
(3 login-page, 2 moderation-page session-gating/logout, 1 backend
`/auth/admin/me` strategy stripping) + 1 new e2e test
(`GET /auth/admin/me`, 10 admin-auth e2e tests / 74 total now) — all
existing moderation-page tests updated to mock the new session-check
call and `next/navigation`'s `useRouter`. Manually verified in a real
headless browser (Playwright, installed ad hoc via `npx playwright
install chromium` — not added as a project dependency) against `api`/
`web` dev servers backed by kind's Postgres/OpenSearch per D24/D26:
fresh `/moderation` → redirected to login; wrong credentials → error
shown, stays on login; correct credentials → reaches the queue;
logout → back to login; back-navigation to `/moderation` after
logout → bounced to login again (no stale client-side state serving
cached data) — zero uncaught JS exceptions and zero console errors
beyond the three expected 401s the auth-check/login flow itself
deliberately triggers.

**Phase 18, issue #161 (engineering blog)** —
`wiki/blog/phase-18-admin-authentication/` gained one post per feature
issue (#159, #160), covering why the phase jumped ahead of Phase 16/17,
the backend session/guard/throttle design, the two real bugs the
frontend work surfaced (`fetch()` needing `credentials: 'include'`
alongside the server's `credentials: true` CORS config; the JWT
strategy leaking `iat`/`exp` into `req.user`), and the full Playwright
verification of the login → queue → logout → re-redirect loop.
`wiki/blog/README.md`'s index updated to match.

**Phase 18 was declared fully done, then reopened the same day** —
issues #159-161 all closed via merged PRs, and every phase built so far
had a complete engineering blog. It didn't stay closed: the first real
login attempt against the actual `kind`-deployed app failed, which led
to a bugfix and two new sub-issues.

**Real login-bug fix (no dedicated issue — found and fixed directly,
same session)**: `AdminAuthController.login()`'s cookie used `secure:
process.env.NODE_ENV === 'production'`. Every deployed container always
runs with `NODE_ENV=production` (baked into the Dockerfile) regardless
of whether it's actually served over HTTPS — and every environment this
project runs in today (local `kind`) is plain HTTP with no TLS
anywhere. Every browser silently refuses a `Secure` cookie over plain
HTTP, so login returned 200 with a valid `Set-Cookie` header but the
browser never stored it — `/moderation` just bounced back to its own
login page with no visible error. Fixed with an explicit `COOKIE_SECURE`
env var (default `false`), matching the `SECRETS_SOURCE`/`CORS_ORIGIN`
precedent of explicit config over inferring behavior from `NODE_ENV`;
also fixed `logout()`'s `clearCookie()` to use the same options the
cookie was set with. Verified directly against the live cluster before
and after (curl through the Ingress showed the bare `Secure` attribute
beforehand, confirmed gone and login actually working afterward).
Documented in `docs/DECISIONS.md` D27 alongside the CSRF stance
(`SameSite=Lax` accepted as sufficient, no separate token) and a
flagged reminder that `COOKIE_SECURE` must be explicitly flipped to
`true` once a real TLS-terminated environment exists (Phase 8) — nothing
does this automatically.

**Phase 18, issue #192 (rotate admin credentials)** — filed once the
login-bug investigation also surfaced that every environment shared the
exact same public dev-only `ADMIN_PASSWORD_HASH`/`ADMIN_JWT_SECRET`
values checked into `api/.env.example`/`infra/k8s/base/05-api.yaml` —
`ADMIN_JWT_SECRET` arguably the more urgent half, since it's the HMAC
key signing every session JWT and being public means anyone could forge
a valid session without ever guessing the password. Real values
generated (`openssl rand`, bcrypt cost 10) and set only as
`ADMIN_PASSWORD_HASH`/`ADMIN_JWT_SECRET` GitHub Actions repo secrets —
never committed to any manifest (verified by grepping the diff for the
actual values before committing). Structurally: `ADMIN_PASSWORD_HASH`/
`ADMIN_JWT_SECRET` moved out of the git-tracked `api-secrets` Secret
entirely into a new `admin-credentials` Secret, provisioned
imperatively by both `cd.yml` (new "Provision admin credentials secret"
step) and `infra/scripts/bootstrap-kind.sh`, mirroring the existing
`localstack-credentials`/`LOCALSTACK_AUTH_TOKEN` pattern (D23) exactly
— a real rotated credential committed to a manifest would be exactly as
public as the dev-only placeholder it replaced. `ADMIN_USERNAME` moved
to the non-secret `api-config` ConfigMap (it's a username, not a
credential). `wiki/deployment-guide.md` gained section 5b and updates
to sections 3/8/10.

**Found while verifying the live rollout — a real `kubectl apply` gotcha,
documented as D28:** after CD ran, `api-secrets`' live `.data` still had
the three old keys (`ADMIN_USERNAME`/`ADMIN_PASSWORD_HASH`/
`ADMIN_JWT_SECRET`) with their stale dev-only values, even though the
`last-applied-configuration` annotation correctly showed them removed —
`kubectl apply`'s 3-way merge doesn't reliably prune a key removed from
a Secret's `stringData`, since the live object never persists
`stringData` itself (only the converted `.data`) for the diff to
reconcile against. Confirmed directly with `kubectl get secret
api-secrets -o jsonpath='{.data}'`, not assumed. Didn't cause a live bug
— `envFrom`'s last-source-wins merge order meant the pod's actual env
vars were already correct (verified via `kubectl exec ... printenv` and
a live login test: new credential works, old dev-only one now 401s) —
but the stale keys were cleaned up directly with `kubectl patch secret
api-secrets --type=json -p='[...remove...]'` rather than left sitting
in the live cluster.

**Phase 18, issue #193 (moderation page: redirect to login on a
mid-session 401)** — a new module-level `isSessionExpired(err)` predicate
in `web/src/app/moderation/page.tsx` (`err instanceof ApiError &&
err.status === 401`), checked in both the queue-load effect's catch
block and `act()`'s catch block — a 401 anywhere now redirects to
`/moderation/login` instead of rendering through the generic `error`
state, matching what the initial-load session gate already did one
level up. Deliberately a plain module-level function, not a
component-scoped closure — the natural first attempt (a `handleActionError`
helper closing over `router`) triggered `react-hooks/exhaustive-deps`,
and fixing that by adding `router` to the queue-load effect's
dependency array combined with the test file's mock `useRouter()`
returning a fresh object literal on every call (not a stable reference,
unlike real Next.js) caused the effect to re-fire on every render in
tests — refetching the queue and silently clobbering an approve/reject/
flag action's optimistic local removal. Fixed at the root: the test
mock now returns one stable `mockRouter` object, matching real Next.js's
actual (memoized) `useRouter()` behavior, which was the more accurate
mock regardless of this bug. 2 new component tests (queue-load 401,
action 401 — both assert the redirect *and* that no generic error text
ever renders) plus the existing suite fixed by the mock change; `web`
build/lint clean. Manually verified in a real headless browser
(Playwright, kind's stores per D24/D26): logged in for real, corrupted
the session cookie in place (simulating the 1h JWT expiring mid-use
without waiting an hour), clicked Approve on a real pending rating —
redirected straight to `/moderation/login` with zero uncaught JS
exceptions and no leaked "Something went wrong"/"failed with 401" text.

**Phase 18 is now fully done** — issues #159-161 and #192-193 all
closed via merged PRs.

**Phase 16 kickoff brainstorm (before implementing)** — issues #144-148
had already been planned (real acceptance criteria, correct dependency
chain) but left two decisions open and one gap unaddressed; resolved
before writing any code: **Mailpit** over LocalStack SES for local mail
delivery (LocalStack SES would drag in AWS-shaped emulation for a
feature with no near-term real-sending plan); **stateless JWT cookie**
for candidate sessions, reusing Phase 18's admin-auth pattern rather
than a new DB-backed sessions table; and **rate-limit the magic-link
request endpoint** from the start (folded into issue #145's scope),
mirroring `LoginThrottleService` — a new public endpoint accepting an
email is the same class of abuse surface admin login was. Issue bodies
for #144/#145 updated to record these decisions before implementation
began. Epic #182 moved to "In Progress".

**Phase 16, issue #144 (mail foundation)** — a new `api` `mail/`
module: `MailService.send()` over a DI-injected `nodemailer` SMTP
transport (`mail-transporter.provider.ts`, same provider-token pattern
as `OPENSEARCH_CLIENT`), configured via `MAIL_SMTP_HOST`/
`MAIL_SMTP_PORT`/`MAIL_FROM_ADDRESS` env vars — no controller yet, no
consumer wired into `AppModule` (that's issue #145's job). Mailpit
added as a core local dependency, not gated behind the
`dev-localstack` overlay (unrelated to LocalStack/secrets emulation):
`infra/k8s/base/08-mailpit.yaml` (a stateless Deployment, no PVC —
losing dev mailbox history on restart is fine) plus an unconditional
`docker-compose.yml` service, matching Postgres/OpenSearch's standing.
Mailpit's REST API shape and the absence of a documented health-check
endpoint were both confirmed by running the real image locally and
inspecting it directly, not assumed from its docs site (which didn't
have the exact endpoint/response shape crawlable) — the k8s manifest
uses a `tcpSocket` probe and CI's service container uses the image's
own busybox `wget --spider` rather than guessing an HTTP health path.
4 new unit tests (mocked transporter) + 1 new e2e test
(`mail.e2e-spec.ts`) proving a message sent through `MailService`
actually lands in Mailpit's inbox, verified against a real instance
both natively (local Docker) and in-cluster (`kubectl apply` directly
against the live `kind` cluster, port-forwarded, before the PR even
merged). `.github/workflows/ci.yml`'s `api` job gained a `mailpit`
service container. Decision documented in `docs/DECISIONS.md` D29.

**Found and fixed while verifying #144's live rollout (no dedicated
issue)** — `infra/k8s/base/05-api.yaml`'s `api-config` ConfigMap never
got `MAIL_SMTP_HOST`/`MAIL_SMTP_PORT` pointing at `mailpit`'s in-cluster
Service DNS name (the same pattern `OPENSEARCH_URL` already used) —
currently inert (no consumer yet), but would have silently fallen back
to `MailService`'s `localhost` default the moment a consumer existed.
Fixed immediately rather than left for issue #145 to rediscover.

**Phase 16, issue #145 (magic-link authentication)** — a new
`api/src/candidate-auth/` module **replaces** the Phase 3
`candidate-verification/` module entirely (removed, not deprecated
alongside — see D30 for why leaving the old, actually-insecure
endpoints live next to a secure replacement wouldn't have been a real
fix). `POST /auth/request-link` upserts the candidate (reusing
`CandidatesService.create()`), issues a single-use 15-minute token
(the same `CandidateVerificationToken` table/utilities, moved not
duplicated), and emails a real link via `MailService` — rate-limited
from the start (`MagicLinkThrottleService`, decided during the Phase 16
brainstorm) and never discloses whether the email was known.
`GET`/`POST /auth/verify?token=` consumes it, starts a
`candidate_session` httpOnly JWT cookie (mirroring Phase 18's
`admin_session` exactly), and flips `verificationStatus` to
`email_verified` on *first* login only (a repeat login doesn't
overwrite `verifiedAt`). `POST /auth/logout` clears it.

Two pieces of admin-auth's own logic were extracted to
`api/src/common/` this time, rather than risk a second copy silently
drifting the way the brainstorm flagged: `session-cookie-options.util.ts`
(the `COOKIE_SECURE` cookie-options object) and `ip-throttle.ts` (the
per-IP attempt-counting core both `LoginThrottleService` and the new
`MagicLinkThrottleService` now wrap). `CandidateJwtStrategy`/
`CandidateJwtAuthGuard` are built and exported now too, ready for issue
#146 to apply to write-path controllers, even though nothing consumes
them yet.

21 new unit tests (service, throttle, strategy, shared utils) + a new
9-test e2e suite (`candidate-auth.e2e-spec.ts`) proving the full
request-link → real Mailpit email → extract token via Mailpit's REST
API → verify → session cookie loop against real Postgres — reuse/
unknown-token rejection, first-login-only `verifiedAt`, supersession of
a prior unconsumed token, and the request-link throttle all covered.
Each test boots its own fresh app instance (`beforeEach`/`afterEach`,
not a shared `beforeAll`) — a first pass shared one app across the file
and several tests' cumulative `/auth/request-link` calls tripped the
throttle before reaching later tests, the same class of issue
admin-auth's e2e suite hit once already.

**Also found and fixed while wiring this up:** Docker Compose's `full`
profile had been unable to boot `api` at all since Phase 18 shipped —
`ADMIN_USERNAME`/`ADMIN_PASSWORD_HASH`/`ADMIN_JWT_SECRET`/
`COOKIE_SECURE` were never added to its environment block, and
`AdminAuthModule` throws synchronously at boot if any are unset. Fixed
alongside adding `CANDIDATE_JWT_SECRET` to the same block; confirmed
(not assumed) that the bcrypt hash's `$` characters survive Compose's
own variable interpolation intact by checking a real container's env
var directly.

**Phase 16, issue #146 (sessions on the write path)** — every
`candidateId`-bearing write now derives it from the authenticated
session (`CurrentCandidateId`, backed by `CandidateJwtAuthGuard`),
never the request body. Turned out to be **four** write paths, not the
three named in the issue's own prose — `InterviewProcess` creation
(`POST /companies/:companyId/processes`) has a `candidateId` column
too, found by grepping the Prisma schema directly rather than trusting
the issue text (`RecruiterInteraction` itself has none — only its
child `RecruiterRating` does, so "recruiter interaction+rating" was
really one write path, not two). `candidateId` dropped entirely from
`CreateRoundRatingDto`/`CreateRecruiterRatingDto`/
`CreateOverallReviewDto`/`CreateInterviewProcessDto`; each service
takes it as a separate parameter instead.

**`POST /candidates` removed entirely** (not just gated) — candidate
creation is upsert-by-email logic that now only runs inside
`POST /auth/request-link`; a parallel public route to mint a candidate
identity without proving email ownership would have undermined the
whole point of this issue. `GET /candidates/:id` is unchanged (a read,
out of scope). See `docs/DECISIONS.md` D31 for the full reasoning,
including the explicit "unauthenticated write → plain 401, no fallback"
decision the issue asked to be documented.

**`web`'s wizard is now broken from its very first step** — it called
`POST /candidates` directly, which no longer exists. Intentional, not a
regression: the same "frontend catches up in the next issue" sequencing
Phase 18 used (issue #159 broke the moderation UI on purpose, #160
fixed it) — issue #147 (login/logout UI + wizard integration) is the
catch-up here. `README.md`'s Quick Start now says so explicitly, with a
pointer to `api/test/support/candidate-session.ts` for driving the
write paths by hand (curl/tests) in the meantime.

A new shared e2e helper, `api/test/support/candidate-session.ts`'s
`loginAsCandidate()`, drives the real request-link → Mailpit → verify
→ cookie loop (mirroring `admin-session.ts`'s `loginAsAdmin()`) — used
by a new dedicated `sessions-on-write-path.e2e-spec.ts` (8 tests
proving the core guarantee across all four write paths: 401
unauthenticated, and a client-supplied `candidateId` in the body is
rejected outright by whitelist validation, never used even if
supplied) and by every existing e2e spec that touches one of the four
write paths (`vertical-slice`, `moderation`, `fraud-checks`,
`overall-reviews`, `recruiter-ratings`, `review-search`,
`company-reviews` — 7 files). Every one of those was also converted
from a shared `beforeAll` app to a fresh app per test
(`beforeEach`/`afterEach`) — a shared instance's cumulative
`/auth/request-link` calls across a whole file routinely exceeded the
5-per-window magic-link throttle once several tests each needed their
own candidate login (`overall-reviews.e2e-spec.ts` hit this directly;
several others were sitting exactly at the boundary). 4 unit test files
updated (DTO + service specs for the three ratings/reviews, DTO spec
for interview-processes) plus 2 new ones (the `CurrentCandidateId`
decorator, extracted separately from its `createParamDecorator` wrapper
for testability). Full e2e suite (83 tests) run twice back to back to
confirm the per-test-app fix wasn't a lucky pass.

**Phase 16, issue #147 (login/logout UI + wizard integration)** — the
fix for #146's deliberate wizard breakage. A new `GET /auth/me`
(`candidate-auth.controller.ts`, mirroring admin's `GET /auth/admin/me`
from #160) gives web a session-check endpoint. New pages:
`web/src/app/login/page.tsx` (email-only, no password — requests a
magic link and shows the same honest "if an account exists…"
confirmation regardless of whether the email is known, matching
`CandidateAuthService.requestLink()`'s own non-enumerating behavior)
and `web/src/app/auth/verify/page.tsx` (the landing route the emailed
link itself points at — its URL is built from `CORS_ORIGIN`, i.e.
`web`'s own origin, so this path had to be exactly `/auth/verify`;
consumes the token, then redirects home on success or shows an
expired/already-used/not-found message with a link back to `/login` on
failure). `web/src/components/NavBar.tsx` now surfaces session state
("Log in" link vs. "Log out" button); the wizard's step 2 drops its
inline "candidate email" field entirely and instead gates the
process-creation form on a real session, showing a "Log in to submit a
review" prompt otherwise; `api.ts`'s four write-path client methods
(`createProcess`/`createRoundRating`/`createRecruiterRating`/
`createOverallReview`) dropped the now-rejected `candidateId` field
from their request bodies (the wizard had been silently broken by
issue #146's whitelist validation until this fix); `createCandidate()`
and the dead `POST /candidates` call are gone, per D31's own "revisit
when" note.

**Two real bugs found and fixed during live Playwright verification,
neither visible from component tests alone** — see `docs/DECISIONS.md`
D32 for the full reasoning:
- **A passive `GET /auth/me` call from `NavBar` on every anonymous page
  view 401s, and Chromium logs every non-2xx fetch response to the
  console** — a real "zero console errors" failure the moment more
  than one page is visited anonymously, i.e. the platform's single most
  common case. Fixed with a non-httpOnly `candidate_logged_in` hint
  cookie, set/cleared in lockstep with the real session cookie, that
  `NavBar` and the wizard read directly via `document.cookie`
  (`api.hasCandidateSessionHint()`) instead of ever calling the network
  endpoint just to render a nav link. `GET /auth/me` itself is
  unchanged and still 401s on a missing session, same as admin's —
  kept for parity and for whatever future need actually wants the real
  `candidateId`.
- **`router.push('/')` after a successful verify left `NavBar` stuck
  showing "Log in"** even though the session cookie was just set —
  `NavBar` is mounted once in the root layout and persists across
  client-side route changes, so its mount-time session check never
  re-ran. Fixed with a hard `window.location.href = '/'` redirect
  instead, which remounts everything fresh.

3 new component test files (`login-page.spec.tsx`, `verify-page.spec.tsx`,
plus `nav-bar.spec.tsx` extended) and 2 existing files updated
(`page.spec.tsx`, `recruiter-overall-steps.spec.tsx`) to drive the
session-hint cookie instead of the removed email step — 42 web tests
total. `GET /auth/me` covered by 1 new e2e assertion
(`candidate-auth.e2e-spec.ts`, 84 e2e tests total). Verified live end
to end (real `kind` Postgres/OpenSearch/Mailpit via port-forward, real
dev servers, headless Chromium): request a link from `/login` → fetch
it from Mailpit's REST API → land on `/auth/verify` → redirected home,
logged in → create a company → create a process with no email field →
add a round → submit a rating — confirmed the row landed in kind's
Postgres via `kubectl exec psql`, zero console errors throughout.

**Phase 16, issue #148 (engineering blog)** —
`wiki/blog/phase-16-candidate-accounts-auth/` gained one post per
feature issue (#144-147), covering the Mailpit-over-LocalStack-SES
decision (D29), the magic-link design and D30's replace-don't-duplicate
reasoning, issue #146's fourth-write-path discovery and the
no-fallback-401 decision (D31), and issue #147's two live-verification
bugs — the session-hint cookie replacing a passive `GET /auth/me` poll,
and the hard-navigation fix for `NavBar` not remounting across
client-side routes (D32). `wiki/blog/README.md`'s index updated to
match.

**Phase 16 is now fully done** — issues #144-148 all closed via merged
PRs, and every phase built so far now has a complete engineering blog.

**Phase 17 kickoff brainstorm (before implementing)** — issues #149-152
had already been planned (filed during the earlier "Phases 15-17
planning" pass) but left three decisions open; resolved before writing
any code, same pattern as Phase 16's kickoff: `GET /me/submissions`
(#149) groups its response by `InterviewProcess` rather than three flat
lists; Update/Delete (#150) is scoped explicitly to the three moderated
content types only (never the structural entities) and gets its own
per-candidate edit throttle extending D13's pattern; GDPR erasure
(#151) clears the requester's session cookies on `DELETE /me` (like
logout) with `CandidateJwtAuthGuard` additionally verifying the
candidateId still exists in the DB (a stale post-erasure token gets a
clean 401, not a downstream FK error), and explicitly excludes the
shared per-company `Recruiter` row from erasure. All three issue bodies
updated on GitHub to record these decisions before implementation
began. Epic #183 moved to "In Progress".

**Phase 17, issue #149 (my reviews)** — a new `api` `me/` module:
`GET /me/submissions` (`CandidateJwtAuthGuard`-gated) queries
`InterviewProcess.findMany({ where: { candidateId } })` with nested
`rounds.ratings`/`recruiterInteractions.ratings`/`overallReview`
includes (each relation re-filtered by `candidateId` defensively, even
though a process structurally has exactly one candidate already), then
maps the result into the process-grouped shape decided during the
kickoff brainstorm — one entry per `InterviewProcess` (company/role/
outcome) with that process's round ratings, recruiter ratings, and
overall review nested underneath, every status (pending/approved/
rejected/flagged) included since this is the one read path where the
owner should see their own not-yet-public content. A round only
appears in `roundRatings` once it actually has a rating (the
`@@unique([roundId, candidateId])` constraint guarantees at most one).
4 new unit tests (mocked Prisma: candidateId scoping, full grouping
shape, a round with no rating omitted, empty-candidate case) + 5 new
e2e tests (`me-submissions.e2e-spec.ts`, 89 e2e tests total) against
real Postgres prove: 401 unauthenticated, empty array for a candidate
with nothing submitted, a full submission (round rating approved,
recruiter rating rejected, overall review still pending) grouped
correctly under its one process with every status intact, another
candidate's submissions never leak, and a process with zero ratings
yet still appears with empty nested arrays (not omitted).

On `web`: a new `web/src/app/me/page.tsx`, gated on the session-hint
cookie (same pattern as `NavBar`/the wizard, not a network probe —
D32) — shows a "Log in to see your own submissions" prompt when
logged out, otherwise fetches `GET /me/submissions` and renders one
card per process (company, role, outcome, a link to that company's
profile) with each nested rating/review shown with its real status
(color-coded, matching this project's existing status-label
conventions) and free text. Distinguishes loading/empty/populated
throughout (Phase 9 issue #61 rule). `NavBar` gained a "My reviews"
link, shown only when logged in. 5 new component tests
(`my-reviews-page.spec.tsx`) + 2 new `NavBar` tests (48 web tests
total). Verified live end to end (real `kind` Postgres/OpenSearch/
Mailpit via port-forward, real dev servers, headless Chromium): logged
in via a real magic link, confirmed `/me` showed the empty state
before any submission, drove the full wizard (round rating + recruiter
rating + overall review, all left pending), confirmed `/me` then
showed all three grouped under one process card with "Pending" labels
and a working company-profile link, logged out, and confirmed `/me`
prompted to log in again with zero stale data leaking — zero console
errors throughout.

**Phase 17, issue #150 (Update/Delete under moderation-safe rules)** —
scoped, per the kickoff brainstorm, to exactly the three moderated
content types (`RoundRating`/`RecruiterRating`/`OverallReview`) — the
structural entities stay create+read-only permanently. Each of the
three services gained `update()`/`remove()`: ownership is checked
against the session candidateId (403 for anyone else, distinct from a
genuinely-missing row's 404 — `findFirstOrThrow` scopes by the parent
id too, e.g. `{ id, roundId }`, so a mismatched round 404s rather than
leaking existence); an edit never modifies public content in place — it
resets `status` to `pending` and re-enqueues; a delete removes the
entity plus its `moderation_queue` entries and, for an approved round
rating only (the one entity type `ReviewSearchService` ever indexes,
D17), best-effort removes it from OpenSearch too.
`ModerationService` gained `reenqueue()` (supersedes any still-
unreviewed entry for that entity before creating a fresh one — an edit
before the first review would otherwise leave two live entries racing
to review the same entity twice) and `removeQueueEntries()` (deletes
every entry, reviewed or not, for a deleted entity — nothing else would
ever clean up `moderation_queue`'s polymorphic, non-FK reference).
`ReviewSearchService` gained `removeReview()`, same best-effort
D16/D17 shape as indexing an approval, silently accepting a 404 (never
indexed) and only logging anything else.

**Edit throttle is one shared budget across all three entity types**
(the user's explicit choice during the kickoff brainstorm), not three
independent counters — a new `api/src/common/edit-throttle.{service,
guard,module}.ts` (5 edits/hour per candidateId, same placeholder-
threshold spirit as D13's `k`), imported by all three write-path
modules so they share one `EditThrottleService` instance. Full design
(including a real cross-module DI bug this surfaced — a guard
referenced by class in `@UseGuards()` needs its *dependencies*
exported from the shared module too, not just the guard itself; every
e2e test failed at app-bootstrap until `EditThrottleService` was added
to `EditThrottleModule`'s `exports`) documented as D33.

New routes: `PATCH`/`DELETE /rounds/:roundId/ratings/:id`,
`PATCH`/`DELETE /recruiter-interactions/:recruiterInteractionId/ratings/:id`,
and (singular resource, no separate id — `UNIQUE(process_id)`)
`PATCH`/`DELETE /processes/:processId/overall-review`. 26 new unit
tests (244 total) + a new 13-test e2e suite
(`update-delete-moderated-content.e2e-spec.ts`, 102 e2e tests total —
100 passing, 2 pre-existing unrelated skips) against real Postgres +
OpenSearch prove: owner-only 403 per entity type; an edit after
approval resets to pending with the reviewed queue entry superseded; an
edit *before* any review also collapses to exactly one live queue
entry (not two); deleting an approved round rating removes it from
public reads, the queue, and the OpenSearch index; deleting a
still-pending rating still cleans up its queue entry; and the shared
throttle trips on the 6th edit.

On `web`: `web/src/app/me/page.tsx` gained per-item Edit/Delete
controls — an inline edit form (pre-filled with the current values) and
a `window.confirm`-gated delete button, per round rating / recruiter
rating / overall review. A successful edit or delete just refetches
`GET /me/submissions` (`onChanged()` callback) rather than hand-patching
nested state, since the server-side status reset is the source of
truth. `web/src/lib/api.ts` gained six client methods
(`update`/`delete` × three entity types) plus 204-No-Content handling in
the shared `request()` helper (a bare `res.json()` on an empty DELETE
response would otherwise throw). 3 new component tests
(`my-reviews-page.spec.tsx`, 51 web tests total) cover the edit-PATCH
call, confirmed delete, and declined-confirmation no-op.

Verified live end to end (real `kind` Postgres/OpenSearch/Mailpit via
port-forward, real dev servers, headless Chromium): logged in via a
real magic link, drove the wizard to a pending round rating, approved
it via the admin API, confirmed `/me` showed "Approved," edited the
rating on `/me` — confirmed it flipped to "Pending" *and* that the
moderation queue held exactly one live entry for it (not two, proving
the supersession) — then deleted it and confirmed both the per-process
"no ratings submitted yet" note and the queue entry's removal, zero
console errors throughout.

**Phase 17, issue #151 (GDPR erasure path)** — resolves the retention/
deletion open decision that had sat in "Open decisions" since Phase 1.
`CandidateJwtStrategy.validate()` now queries `candidate.findUnique()`
and throws `UnauthorizedException` if the candidateId no longer
exists — sessions are stateless JWTs with no server-side revocation
(Phase 16's own brainstorm decision), so a token surviving past
erasure would otherwise still pass signature/expiry checks and hit a
downstream FK/not-found error instead of a clean 401. One extra DB
round trip on every authenticated candidate request, an accepted
trade-off (decided during the kickoff brainstorm).

`MeService.eraseMe(candidateId)` deletes, in FK-safe order:
`RoundRating`/`RecruiterRating`/`OverallReview` (+ their
`moderation_queue` entries, gathered by id list up front — issue #150's
`removeQueueEntries()` idea, batched here) → `Round`/
`RecruiterInteraction` → `InterviewProcess` →
`CandidateVerificationToken` → `Candidate` last — all in one
`$transaction`. Delete, not anonymize (D34): no raw identity is stored
anywhere (only an HMAC), and the public aggregates this candidate's
content fed are already de-identified, out of GDPR scope once computed,
and simply recompute correctly on the next materialized-view refresh.
Structural entities are in scope here even though issue #150 explicitly
excluded them from Update/Delete — #150 was about not letting edits
undermine moderation; erasure is about a person's data not persisting,
and `InterviewProcess.candidateId` is a required FK Prisma won't let you
orphan anyway. An approved round rating's OpenSearch document is
best-effort removed after the transaction commits (same D16/D17
pattern). The shared `Recruiter` row is never touched — only the
candidate's own `RecruiterInteraction` rows are deleted.

New route: `DELETE /me` (`CandidateJwtAuthGuard`-gated, 204), clearing
both `candidate_session`/`candidate_logged_in` cookies the same way
`POST /auth/logout` does. `CandidateJwtStrategy`'s spec now covers the
post-erasure 401 case alongside its existing ones, and `MeService`
gained 5 new `eraseMe()` tests (deletion order, moderation-queue
cleanup by id list, Recruiter-row exclusion, and search-removal
scoped to approved-only) — 250 api unit tests total — plus a new
3-test e2e suite (`gdpr-erasure.e2e-spec.ts`, 105 e2e tests total)
against real Postgres + OpenSearch prove: a full
erasure leaves zero rows across every table (verified by direct
Postgres queries, not just HTTP responses) and both search indices
gone, with `company_round_type_aggregates` converging to zero rows for
that company/round-type on the next refresh; a stale post-erasure
session gets a clean 401 from `GET /me/submissions`, not a downstream
error; and erasing one candidate never touches another candidate's
`RecruiterInteraction`/`RecruiterRating` sharing the same company's
`Recruiter` row (proven by actually creating two candidates against the
same shared recruiter identifier and confirming candidate B's data
survives candidate A's erasure).

On `web`: `web/src/app/me/page.tsx` gained a "Danger zone" section at
the bottom with a "Delete my account" button — `window.confirm`-gated
(same pattern as every other delete on this page, worded explicitly
about scope/irreversibility since this is a bigger action than deleting
one item), hard-navigating home (`window.location.href = '/'`, not
`router.push`) after a successful erasure — same D32 reasoning as the
post-verify redirect, since `NavBar` won't otherwise notice the session
is gone. `web/src/lib/api.ts` gained `deleteAccount()`. 4 new component
tests (`my-reviews-page.spec.tsx`, 54 web tests total) cover the Danger
zone rendering, confirmed erasure + hard navigation, and a declined
confirmation no-op.

Verified live end to end (real `kind` Postgres/OpenSearch/Mailpit via
port-forward, real dev servers, headless Chromium): logged in via a
real magic link, submitted a round rating, clicked "Delete my account"
on `/me`, confirmed the browser landed back on the anonymous homepage
with zero console errors, confirmed directly via `kubectl exec` psql
that the candidate row and every row it had touched were gone, and
confirmed the same session cookie replayed against `GET /me/submissions`
returned a clean 401.

**Phase 17, issue #152 (engineering blog)** —
`wiki/blog/phase-17-candidate-self-service/` gained one post per
feature issue (#149, #150, #151), covering the my-reviews
grouped-by-`InterviewProcess` design, Update/Delete's moderation-safe
`reenqueue()`/ownership-403-vs-404 rules and the shared-guard DI bug it
surfaced (D33), and GDPR erasure's delete-not-anonymize reasoning,
FK-safe deletion order, shared-`Recruiter`-row exclusion, and the
stateless-session existence check (D34). `wiki/blog/README.md`'s index
updated to match.

**Phase 17 is now fully done** — issues #149-152 all closed via merged
PRs, and every phase built so far (1-7, 9-18) now has a complete
engineering blog.

**Real CD incident found and fixed directly (Phase 20, GitHub issue
#215 — filed retroactively after the fact), same day as #152's
merge** — the PR #208 merge (unrelated to this incident)
triggered `cd.yml` as usual, and the "Roll out api" step timed out: the
new pod crash-looped on an OpenSearch `cluster_block_exception`
(flood-stage watermark). Root cause was several layers removed from the
app itself: five days of CD runs had left the shared Docker Desktop
disk at 96% full, almost entirely build cache and dangling images from
every prior "Build api/web image" step (`kind load` retags forward but
never removes what it replaces, and the self-hosted runner — issue
#88 — is a persistent local machine, not a fresh disk per run). `api`/
`web` were never actually down (the old pod kept serving throughout);
the deploy was just stuck. Fixed live: pruned dangling images + build
cache (96% → 49% disk), cleared OpenSearch's blocks, re-ran the
rollout — both pods now healthy on the latest commit. A near-miss
during manual diagnosis is documented in D35: node-internal
`crictl rmi --prune` briefly deleted the image tags backing the
then-live `web` Deployment and `ingress-nginx-controller` pod (neither
caught by "unreferenced" logic, since Kubernetes tracks a running
container by digest, not tag) — both restored immediately before
either pod needed to restart, no actual outage. `cd.yml` gained a
`Prune stale Docker artifacts` step (`if: always()`, host-level
`docker image prune`/`docker builder prune` only — deliberately never
`crictl`/`ctr` inside the kind node, per the near-miss) so this doesn't
recur. See D35 for the full incident writeup.

**Full golden-path smoke test added (Phase 20, GitHub issue #216 —
filed retroactively)** — the same dev-DB cleanup that produced D35 also surfaced that
every "verify it live" script this project has ever written was a
throwaway, pointed at the persistent dev cluster, and left no way to
sanity-check the whole feature set without either rewriting one or
polluting the dev DB again. `api/test/golden-path.smoke-spec.ts` — one
continuous narrative test (company → candidate auth → all three
moderated content types → moderation → search → analytics, clearing
the n=3 shrinkage floor for a real score → my-reviews → update/delete
→ GDPR erasure), reusing every existing e2e helper — runs via a new
`npm run smoke:e2e`, deliberately opt-in and never wired into
`npm run test:e2e`/CI. A new `assertUsingTestDatabase()` helper
refuses to run it against anything but `interview_insights_test`,
the concrete guardrail against a repeat of D35's incident. A
real-browser (Playwright) companion is explicitly deferred, not built
here. Documented in `wiki/deployment-guide.md` section 6.1 and
`docs/DECISIONS.md` D36.

**Real bug found and fixed via the smoke test's own verification
(GitHub issue #212)** — stress-testing the e2e suite surfaced an
intermittent `GET /moderation/queue` 500, jumping between unrelated
test files each time. Root cause: `ModerationService.listPending()`
enriches each entity type via a required-relation Prisma `include`
several levels deep, which can transiently throw if a concurrent GDPR
erasure/Update-Delete commits between Prisma's own internal round
trips for that include — confirmed the FK itself is real and
Postgres-enforced (`ON DELETE RESTRICT`), so this is a query-time race,
never a durable orphaned row. The actual bug was the blast radius: one
entity type's transient failure crashed the *whole* endpoint via
`Promise.all`. Fixed with `Promise.allSettled` — a failed batch logs
and degrades to `entity: null` for just its own entries, never
affecting the other two types or crashing the endpoint. Stress-verified
8+ consecutive full-suite runs before/after: the underlying race still
fires occasionally (confirmed in logs) but no longer fails any test.
Documented in `docs/DECISIONS.md` D37.

**Login-page copy fixed + `POST /companies` locked down (Phase 20,
GitHub issue #217, product-review findings, D38)** — the login page's confirmation
copy read as login-only ("if an account exists...") even though the
same form always upserts a new candidate; rewritten to say plainly
that it creates an account too. Separately, `POST /companies` had
never been session-gated or rate-limited — an open anonymous-write gap
predating Phase 16 entirely, since `Company` has no `candidateId` and
was never on that phase's write-path list. Now gated with
`CandidateJwtAuthGuard` *and* a new per-IP `CompanyCreationThrottleGuard`
(defense in depth, not attribution — `Company` still has no
`candidateId`). `web`'s wizard only gates the create-form, not
selecting an existing company (a read). Every e2e spec calling
`POST /companies` (13 files, 20 call sites) updated to attach a
candidate cookie. 257 api unit tests, 105 e2e tests, 56 web tests all
green; live-verified in a real browser (anonymous visit shows a
"Log in" prompt instead of the create form, logging in reveals it,
creating a company succeeds, and a direct unauthenticated
`POST /companies` gets 401) — zero console errors.

**Phase 20 was declared fully done, then reopened the same day** — a
user report ("nav bar shows log in even after login") led to a real
bug (GitHub issue #222, D39): `getSessionCookieOptions()` never set a
`Domain` attribute, so every session cookie (`admin_session`,
`candidate_session`, `candidate_logged_in`) was host-only — invisible
to `web`'s JS on any deployed environment, since `web`/`api` are served
from genuinely different hostnames there (`app.*` vs `api.*`). Never
caught before because nearly every prior "verified live in a real
browser" pass used local dev servers on `localhost` (same host,
different port — cookies scope by host, not port). Blast radius was
bigger than the NavBar label: the wizard's `candidateSession &&` gates
(issue #217) read the same hint cookie, so a real login looked logged-
out throughout the app on any deployed environment, even though
authenticated API calls themselves worked fine. Fixed with a new
`COOKIE_DOMAIN` env var (default unset, preserving today's `localhost`
behavior) — set to `.interview-insights.local` in `dev`/`dev-localstack`,
patched per-environment in `staging`/`prod`, mirroring the existing
`CORS_ORIGIN` pattern exactly. 260 api unit tests, 105 e2e tests, and
the golden-path smoke test (13 steps) all green. Live-verified two ways: `curl`
through the real Ingress confirms `Set-Cookie` now carries
`Domain=.interview-insights.local`, and a headless-browser (Playwright)
run through the actual `app.interview-insights.local` (not a dev
server) confirms NavBar shows "Log out" both right after login and
after a hard reload, zero console errors. Epic #214 and milestone #17
reopened, same precedent Phase 18 already set.

**Phase 20 is now fully done** — issues #215-218, #212, and #222 all
closed via merged PRs, and every phase built so far has a complete
engineering blog.

**Phase 21 (Anonymous Visitor Soft-Gating)** — filed after a UI/UX
brainstorm surfaced a deliberate product pivot: soft-gate (teaser + CTA,
never a hard redirect) the company profile page and analytics dashboard
for anonymous visitors, to drive candidate signups — asked directly and
confirmed as a genuine pivot toward signup pressure, not a scraping
concern, reversing part of Phase 15's fully-public design intent. A new
`GatedSection` component (mirroring `EmptyState`'s minimal style, driven
by the existing `hasCandidateSessionHint()` cookie-hint idiom, D32) keeps
the profile page's header + "Overall experience" as a free hook while
gating the round-type breakdown and reviews beyond the first; the
analytics page gates all three data sections behind one combined prompt.
The homepage wizard's company picker and "Change company" button stay
ungated — pure navigation with no data to tease (GitHub issue #226, D40).
77 web tests, lint, build all green; live-verified against the real
`kind` cluster with seeded data via headless-browser (Playwright):
anonymous visits show the gate prompts with content genuinely absent,
logged-in visits show everything, zero console errors. **Phase 21 is now
fully done** — issues #226-227 closed via merged PRs, and every phase
built so far has a complete engineering blog.

**Phase 22 (Visual Design Refresh)** — a mechanical visual-polish pass,
not a redesign, from the same brainstorm as Phase 21, addressing "looks
simple but not cool." An inventory found real, concrete gaps: no custom
font/theme, no page background at all (light or dark — a real
prerequisite gap, since a card's shadow needs a distinct background to
read as elevated), and 11 call sites duplicating the identical
flat-border card string independently. Fixed with `Inter` via
`next/font/google` (self-hosted at build time), an explicit
`bg-gray-50`/`dark:bg-gray-950` page background, a new `Card` component
(`rounded-xl` + `shadow-sm`, an `as="div"|"section"` prop to preserve
document-outline semantics), controls bumped to `rounded-md` with
`transition-colors` added everywhere (a clean addition — no
`transition-*` existed anywhere before), and a `PageContainer` `size`
prop (narrow for forms, wide for search/profile/analytics/moderation)
with `NavBar`'s own width synced to match. Color-palette expansion and
a real brand mark were explicitly scoped out as a second-pass option —
both are subjective design-taste calls, not mechanical fixes. 65 web
tests, lint, build all green; live-verified against the real `kind`
cluster via headless-browser (Playwright): confirmed the font actually
loaded, the correct page background per theme, correct container widths
(672px narrow / 896px wide), and took screenshots in both themes
confirming cards visually read as elevated — zero console errors.
**Phase 22 is now fully done** — issues #231-232 closed via merged PRs,
and every phase built so far has a complete engineering blog.

**Phase 23 (Color System & Brand Mark)** — the two directions
deliberately scoped out of Phase 22 as design-taste calls: `Button`
gained a `variant?: 'primary' | 'danger' | 'neutral' | 'warning'` prop,
formalizing colors already doing real work in the app (indigo/red/
gray/amber) rather than introducing a new accent hue — replaces 10
duplicated inline `bg-red-600`/`bg-gray-600` overrides across
`me/page.tsx`/`moderation/page.tsx`. `Button` and every repeated
text-input class string also gained visible `focus`/`focus-visible`
ring styling, a real accessibility gap, not decoration. A new
`BrandMark` component (an inline SVG star badge, no external asset —
same self-contained approach as `next/font/google`) sits beside the
"Interview Insights" wordmark in `NavBar` and doubles as the site
favicon via Next.js's `app/icon.svg` convention. 65 web tests, lint,
build all green (`button.spec.tsx`'s default-variant assertion and
`nav-bar.spec.tsx`'s accessible-name assertion both passed unchanged);
live-verified against the real `kind` cluster: favicon serves at
`/icon.svg`, brand mark renders, focus ring shows on input focus, a
real logged-in session's "Delete my account" button computes to the
correct red — zero console errors. **Phase 23 is now fully done** —
issues #236-237 closed via merged PRs, closing out all five original
UI/UX brainstorm items, and every phase built so far has a complete
engineering blog.

**Phase 20 reopened a second time the same night (GitHub issue #240,
D43)** — a CD deploy failed with the exact D35 crash signature
(OpenSearch's flood-stage watermark → `api` crash-loop) but from a disk
D35's fix never covers. D35's "Prune stale Docker artifacts" step only
cleans the *host* Docker Desktop cache; `kind load docker-image` copies
images into the *kind node's own internal containerd store* and
retags forward without removing prior layers there — a separate
location that one heavy day (Phases 20-23, ~8 rebuild+`kind load`
cycles) pushed to 91% full on its own. Cross-referenced every running
pod's actual image digest cluster-wide before removing anything —
confirmed the then-running `api`/`web`/`ingress-nginx-controller`
images were each depending on a digest only reachable via an untagged
`import-*` entry (the tag had since moved past them), exactly the
condition D35's own near-miss already warned about; a blind
`crictl rmi --prune` would likely have repeated it for real. Also found
live: `crictl rmi` doesn't reclaim disk until `containerd` itself is
restarted afterward — deletion alone and restart alone each measured
zero change, only both together freed space. New
`infra/scripts/prune-kind-node-images.sh` captures exactly this
keep-set-aware sequence, wired into `cd.yml` as a second `if: always()`
prune step. Verified live against the real incident (91%→45% disk
freed, stuck rollout unblocked) and again afterward against the
now-clean cluster. **Phase 20 is now fully done** — issue #240 closed
via merged PR, and every phase built so far has a complete engineering
blog.

**Phase 20 reopened a third time (GitHub issue #278, D51)** — a user
report of stale/duplicated `/search` results ("co" returning one real
company plus nine identical "Profile Co" ghosts) traced to the
`companies` OpenSearch index holding 420 documents against only 5 real
Postgres rows. Root cause: indexing (D16) only ever happens on
company creation; the only thing that has ever deleted a company row
is a manual `DELETE FROM companies` during live-verification test
cleanup (D44's pattern), which only ever touched Postgres — nothing
re-synced the index, so every uncleaned test company across many past
phases' verification sessions accumulated as a permanent ghost. D44's
own checklist (`wiki/deployment-guide.md` section 6.2) already named
the correct manual step; it just wasn't being followed reliably at
scale. Fixed by (1) deleting the 415 confirmed orphans directly, via a
full ID diff against Postgres with zero false positives, and (2)
adding `api/scripts/prune-orphaned-company-search-docs.js`
(`npm run prune:orphaned-company-search-docs -- --dry-run` / without
the flag) so this is a one-command diff-and-delete rather than a
trust-the-checklist manual step — deliberately not wired into any
automated job, since company deletion itself is always a manual,
deliberate action. `wiki/deployment-guide.md` section 6.2 updated to
reference the script. Epic #214 and milestone #17 reopened and
re-closed the same day, same precedent as #222/#240. **Phase 20 is now
fully done** — issue #278 closed via merged PR, and every phase built
so far has a complete engineering blog.

**Phase 20 reopened a fourth time (GitHub issue #312)** — asked why
Mailpit's local port-forward kept dying, and the honest answer turned
out not to be Mailpit-specific at all: Postgres's and OpenSearch's
forwards died the identical way, repeatedly, during Phase 28's live
verification. Root cause: `kubectl port-forward ... & disown` only
survives as long as the shell process that started it, and this
project's AI-assisted dev sessions can run separate tool calls in
separate shells — a background job from one doesn't reliably survive
into the next (this session's own logs show a literal "Shell cwd was
reset" notice, direct evidence of exactly that). Fixed with
`infra/scripts/dev-port-forwards.sh` (`start`/`stop`/`restart`/
`status`): wires all three forwards into macOS launchd LaunchAgents
instead, supervised independently of any shell, with `KeepAlive`
auto-restarting a forward if the underlying `kubectl port-forward`
process ever exits. Written as a bash-3.2-compatible script (a `case`
statement, not `declare -A` — macOS's actual default `/bin/bash`
predates associative arrays; an early draft used one and broke
immediately), matching every other script in `infra/scripts/`.
Verified persistence directly, not just assumed: started the
forwards, then `exec`'d into a completely fresh shell process and
confirmed all four ports were still listening; separately killed the
Postgres `kubectl port-forward` process directly and confirmed
`KeepAlive` relaunched it within seconds. `wiki/deployment-guide.md`
updated in three places (the native dev-loop instructions, the
direct-access instructions, and the machine-migration checklist) to
use the script instead of the plain backgrounded command. Epic #214
reopened and re-closed the same day, same precedent as #222/#240/
#278. **Phase 20 is now fully done** — issue #312 closed via merged
PR, and every phase built so far has a complete engineering blog.

**Phase 20 reopened a fifth time (GitHub issue #347, D54)** — a user
report on the public company profile page: the Reviews section listed
every approved round rating as its own row and labeled the count "N
reviews," so a single 3-round submission plus one separate 1-round
submission read as "4 reviews" instead of the real 2 — the exact
flat-list problem Phase 29 issue #315 already fixed for the moderation
queue, now on the public-facing surface. Fixed by grouping approved
round ratings by their parent `InterviewProcess` in
`CompaniesService.findApprovedReviews()`, the same `Map`-keyed
grouping shape `ModerationService.listPending()` already uses. The
harder part was pagination: `total`/`page`/`pageSize` now describe
submissions, not raw rows — rows are fetched unpaginated, grouped, then
the *group* array is sliced for the requested page, so one submission's
rounds can never be split across a page boundary the way paginating
raw rows first would risk. `CompanyReviewItem` (frontend) dropped
`roleTitle` to a new group-level `CompanyReviewGroup`; the company
profile page gained a `ReviewGroupItem` component (one collapsed card
per submission, expanding on click to reveal every round's detail) in
place of the old flat `ReviewItem` — Phase 21's existing `GatedSection`
soft-gating needed zero changes, since it already operated generically
on `items[0]` vs. `items.slice(1)` regardless of what an item contains.
4 new/updated api unit tests + 3 new e2e tests (310 api unit tests, 142
e2e tests total) prove grouping and the page-boundary guarantee
directly; 9 web component tests updated for the grouped/expandable
shape (125 web tests total). Live-verified against the real `kind`
cluster via both a direct API check and a real headless-browser
(Playwright) run against the exact data the report was about:
confirmed "2 reviews" (not 4), the free-preview group collapsed by
default, expanding it revealed all 3 rated rounds, and the second
submission stayed properly gated for an anonymous visitor — zero
console errors. Epic #214 reopened and re-closed the same day, same
precedent as #222/#240/#278/#312. **Phase 20 is now fully done** —
issue #347 closed via merged PR, and every phase built so far has a
complete engineering blog.

**Phase 20 reopened a sixth time (GitHub issue #349, D55)** — a user
live-usage report, found while checking whether `/me` had the same
grouping issue #347 fixed on the company profile page (it didn't — `/me`
was already grouped by `InterviewProcess` since Phase 17, before #315
ever existed). What the check surfaced instead: each process card
labels `InterviewProcess.outcome` (the candidate's own self-reported
result — `offer`/`rejected`/`withdrawn`/`ghosted`/`in_progress`) as a
bare word, sitting right alongside up to five nested moderation
statuses that happen to share overlapping vocabulary
(`approved`/`pending`/`rejected`/`flagged`). A process outcome of
`rejected` displayed as bare "Rejected" read exactly like a sixth
moderation verdict — especially confusing since it was the *opposite*
of what every real moderation status on the same card said. Fixed with
a one-line, copy-only prefix: `Outcome: Rejected` instead of a bare
`Rejected`, in `web/src/app/me/page.tsx`. No test changes needed — the
one existing test asserting a bare "Rejected" was checking a nested
recruiter-rating's moderation status, not the process outcome, so it
was unaffected; 125 web tests, build, lint all still green. Epic #214
reopened and re-closed the same day, same precedent as
#222/#240/#278/#312/#347. **Phase 20 is now fully done** — issue #349
closed via merged PR, and every phase built so far has a complete
engineering blog.

Phase 19 (Content Quality & Synthetic Data) remains planned but not
started (GitHub issues #162-165) — now queued behind Phases 24-26
below, planned more recently and with a more immediate user priority.

**Phases 24-26 planning (Round-Type Registry & Rating Redesign; Bulk
Process Submission API; Client-Side Draft Wizard)** — filed 2026-07-25
from a UI/UX brainstorm about streamlining round-level rating detail
(round-type-specific fields via the existing `type_metadata` JSONB
column, interviewer traits reduced to fluency/clarity/focus, expanded
recruiter-touchpoint fields) and a full wizard rewrite (client-side
draft state until final submit, flashcard-style free step navigation,
a chronological final review). Three tightly-sequential phases planned
together (mirroring the "Phases 15-17 planning" precedent), implemented
strictly in order: Phase 24 (epic #244, issues #247-#250) redesigns the
rating field shapes and introduces a shared round-type registry; Phase
25 (epic #245, issues #251-#252) adds a bulk transactional
process-submission endpoint the existing per-entity endpoints don't
replace; Phase 26 (epic #246, issues #253-#256) rewrites the wizard
around client-side drafting on top of both. The recruiter-field
mapping (issue #249) has real open questions flagged for a kickoff
brainstorm before implementation, same pattern Phase 16/17/21 each
used. All three epics are on the project board at "Todo" — planning
only, no implementation started yet.

**Phase 24, issue #247 (round_ratings interviewer-trait field
redesign)** — `difficulty` unchanged (round/problem axis, not a
trait); `communication_fluency`→`fluency` and `attentiveness`→`focus`
are true renames (`RENAME COLUMN`, preserving data); `fairness`/
`bias_signal` dropped outright; `clarity` is new. `company_round_type_
aggregates` (a materialized view, not Prisma-managed) dropped and
recreated with the new column set — Postgres won't let you `ALTER` a
column a view depends on. Every consumer updated in the same pass:
DTOs, `RoundRatingsService`, `ReviewSearchService`, `MeService`,
`CompaniesService`, `ModerationService`, `AnalyticsService`/
`GlobalAveragesService`, the wizard's rating form, `/me`'s edit form,
the company profile page (now shows all 4 fields as its round-type
summary instead of 3-of-5, since there's no longer a meaningfully
richer analytics-only version), the analytics dashboard, the search
page, the moderation queue detail view, and every unit/e2e/smoke test
referencing the old field names (D45). 260 api unit tests, 105 e2e
tests, the golden-path smoke test, and 65 web tests all green;
live-verified through the real Ingress-fronted app: wizard submission
with the new fields, `/me` echoing them back correctly, an anonymous
analytics-page visit correctly showing Phase 21's gate (not a
regression), and a logged-in visit showing the real `fluency`/
`clarity`/`focus` labels — zero console errors throughout. Along the
way, fixed two real, pre-existing test-database gaps this surfaced:
the `interview_insights_test` database had never had this migration
applied (a genuinely separate database from dev, needing its own
`prisma migrate deploy`) and had 112 leftover `round_ratings` rows
from prior sessions blocking the `NOT NULL` column add — truncated,
since it's disposable test data by design (D24).

**Phase 17 reopened (GitHub issue #260, D46)** — a real user report
while looking at their own `/me` page, found while live-verifying
issue #247: several `InterviewProcess` rows had a `Round` created but
were abandoned before ever submitting a rating, showing "No ratings
submitted for this process yet." forever with no cleanup path. New
`DELETE /processes/:id` (`CandidateJwtAuthGuard`, same ownership 403/
404 pattern as `RoundRatingsService.remove()`) only succeeds when the
process is genuinely empty — zero ratings/reviews across every
status, a still-`pending` one included, since there's real content to
lose either way; otherwise 409. Deliberately narrower than issue
#150's own "never structural entities" scope decision, not a reversal
of it — #150 is about not letting edits undermine moderation, this is
about not letting truly-empty data sit forever, and the two don't
actually conflict. `/me` gained a "Delete process" button exactly
where the empty-state message already showed. 265 api unit tests, 111
e2e tests (6 new), the golden-path smoke test, and 67 web tests (2
new) all green; live-verified against the real cluster: a fresh
abandoned process showed the button and deleted cleanly, a real
submission never showed it, and the actual leftover rows from the
original report were cleaned up directly (plus an orphaned
moderation-queue entry the verification itself left behind, same D44
pattern). Structurally superseded once Phase 26 ships, since an
abandoned draft will never reach the database at all — this stays
useful afterward too. **Phase 17 is now fully done** — issue #260
closed via merged PR.

**Phase 24, issue #248 (round-type registry, expanded to all 8 round
types + admin-managed controlled values)** — before implementation,
the project owner expanded this issue's scope directly: rather than
just `coding`/`system_design`, all 8 `RoundType` values get a
structured `type_metadata` schema, and the values behind
controlled-vocabulary fields (which algorithms, which leadership
principles, etc.) must be admin-manageable through a UI, not
hardcoded — with a new phase for that admin gateway (D47). New
`round_type_field_options` table (`roundType`, `fieldKey`, `value`,
`sortOrder`, `isActive` — retire, never hard-delete, so historical
`type_metadata` stays valid) seeded via migration with illustrative
defaults across the 7 structured round types (`other` has no
controlled field — it's the catch-all by definition, only a free-text
`notes` key). New `api/src/round-type-registry/` module: a static
config (round type → field → `text`/`controlled-single`/
`controlled-multi`) plus `RoundTypeFieldOptionsService`, whose
`validateTypeMetadata()` is called from `RoundsService.create()`
(service-layer validation, matching `FraudChecksService`/
`ModerationService`'s existing pattern, not an async DTO validator) —
rejects an unknown key or an inactive/unknown controlled value with a
400. New public `GET /round-types/field-options` returns the full
schema with active options per field, for Phase 26's wizard rewrite to
eventually consume. Deliberately backend-only, per the same scope
discussion — the current wizard (`web/src/app/page.tsx`) is untouched,
since Phase 26/issue #254 replaces its round-creation step entirely
soon after. 16 new unit tests (281 total) + 6 new e2e tests (117
total including 2 pre-existing unrelated skips) all green; live-verified
via curl against the real dev Postgres: the new endpoint's shape, a
valid coding round round-tripping with real algorithm/data-structure
values, and an invalid algorithm value correctly rejected with a 400 —
test data cleaned up directly afterward (D44 pattern).

**Phase 27 planning (Admin Content Gateway)** — filed alongside issue
#248 per the same conversation, since admin management of
`round_type_field_options` is a new, separately-scoped body of work
issue #248 itself doesn't need to unblock Phase 25/26 (which get real
seeded defaults from issue #248 directly). Milestone "Phase 27 — Admin
Content Gateway (Round-Type Field Options)", epic #262, issues #263
(admin CRUD API, `AdminJwtAuthGuard`-gated same as
`ModerationController`), #264 (admin UI page mirroring
`moderation/page.tsx`'s session-check shape), #265 (engineering blog,
last). Numbered after Phase 26 in filing order and implemented after
it too — unlike several earlier non-linear phases, nothing in Phase
25/26 depends on this admin UI existing yet. Epic #262 on the project
board at "Todo" — planning only, no implementation started.

**Phase 24, issue #249 kickoff brainstorm (before implementing)** —
resolved 2026-07-25, same pattern Phase 16/17/21 each used. Unlike
issue #247's clean 1:1 rename, this one had five real open questions,
all resolved directly with the project owner and recorded in the
issue body: `response_time`+`timeliness` merge into one
`responsiveness` field (candidates can't cleanly separate "replied
fast" from "kept to promised dates" — same reasoning as #247 dropping
overly-correlated axes); `communication_quality` dropped entirely,
folding into `reachability`/`responsiveness`/free text rather than
staying a 5th field; `reachability` is a rename+reinterpretation of
`approachability` (friendliness → availability), not a new axis;
`guidelines_shared` is a 1-5 rating (not boolean), keeping every
column on the table uniform; `rejection_message_authenticity` is a
nullable 1-5 column, self-reported with no backend gating against
`InterviewProcess.outcome` (`RecruiterInteraction` has no outcome
link of its own — a process-level fact, not interaction-scoped — so
gating would need an extra join and risks a race if the interaction
is logged before the process outcome is finalized). Final field set:
`reachability`, `responsiveness`, `guidelinesShared`,
`rejectionMessageAuthenticity` (nullable) — matches the issue's
originally-proposed 4-field target exactly. Implementation (migration,
materialized view, DTOs/services, wizard/`/me`/analytics/moderation
frontends, every test referencing the old field names) is now
unblocked but not yet started.

**Phase 24, issue #249 (recruiter_ratings field redesign)** —
implements the kickoff brainstorm's five resolved decisions (D48):
`response_time`+`timeliness` merged into one `responsiveness` column
(rename+drop); `communication_quality` dropped entirely;
`approachability` renamed+reinterpreted as `reachability`;
`guidelines_shared` added as a 1-5 rating; `rejection_message_
authenticity` added as a nullable 1-5 column, self-reported with no
backend gating against `InterviewProcess.outcome`. Migration mirrors
issue #247's shape — `company_recruiter_aggregates` (materialized
view) dropped/recreated with the new 3-column set
(`avg_reachability`/`avg_responsiveness`/`avg_guidelines_shared`;
`rejection_message_authenticity` deliberately excluded, same
precedent `technical_depth` already set). Every consumer updated in
the same pass: `CreateRecruiterRatingDto`, `RecruiterRatingsService`
(field-agnostic, no change needed), `MeService`, `AnalyticsService`/
`GlobalAveragesService`, `ModerationService`'s queue-detail
serializer, the wizard's recruiter step, `/me`'s edit form, the
moderation queue UI, the analytics dashboard's recruiter section, and
every unit/e2e test referencing the old field names. 4 new unit tests
(DTO validation for `rejectionMessageAuthenticity`'s bounds/
optionality) + 2 new e2e tests (`rejectionMessageAuthenticity`
null-when-omitted and real-value round-trips) added to the existing
suites; 285 api unit tests, 119 e2e tests (117 passing + 2
pre-existing unrelated skips), 67 web tests all green; `api`/`web`
build/lint clean. Live-verified via curl
against the real dev Postgres: created a recruiter rating with the new
field names, confirmed `rejectionMessageAuthenticity` defaults to
`null` when omitted and round-trips a real value when provided, and
confirmed the analytics endpoint's recruiter scores use the new
3-field shape.
**Phase 24, issue #250 (engineering blog)** —
`wiki/blog/phase-24-round-type-registry-rating-fields/` gained one post
per feature issue (#247, #248, #249), covering the round rating trait
reduction and its drop-view/rename/recreate-view migration shape, the
round-type registry's mid-flight scope expansion to all 8 round types
plus the admin-managed option values it split off into Phase 27, and
the recruiter rating field redesign's kickoff-brainstorm decisions
(D48) including the nullable self-reported `rejectionMessageAuthenticity`
design. `wiki/blog/README.md`'s index updated to match.

**Phase 24 is now fully done** — issues #247-250 all closed via merged
PRs, and every phase built so far now has a complete engineering blog.

**Phase 25, issue #251 (bulk process-submission endpoint)** — new
`POST /companies/:companyId/processes/bulk` (candidate session
required, `candidateId` from session per D31), accepting a whole
process tree — process fields, `rounds` (each with an optional
`rating`), `recruiterInteractions` (each with an optional `rating`),
an optional `overallReview` — in one payload. New
`api/src/bulk-process-submission/` module wraps the entire creation
in one `prisma.$transaction()`: any failure rolls back everything,
no partial success (D49) — confirmed directly with the project owner
before implementation, resolving the one thing issue #251 itself
flagged as "decide during implementation." Round ratings and
recruiter ratings/interactions are created **sequentially inside the
loop**, not in parallel — deliberately, since `FraudChecksService`'s
rolling-window rate-limit check reads via the same transaction
client, so later round ratings in the same bulk call correctly see
earlier ones already inserted in that same transaction. Existing
per-entity endpoints are untouched. Round-type registry validation
(D47/#248) and fraud-check flagging (D13) both apply exactly as they
do on the incremental path, just inside the one transaction. 7 new
unit tests (mocked Prisma/services, every entity-type combination) +
5 new e2e tests (401, process-only submission, full-tree creation
with matching moderation_queue entries, atomic rollback on a nested
validation failure — proven directly via a zero-row query after a
deliberately invalid second round — and candidateId-whitelist
rejection) all green. Also added the bulk endpoint as a sixth
candidateId-bearing write path to `sessions-on-write-path.e2e-spec.ts`
(issue #146's central enumeration file) — doing so pushed that file's
shared-`beforeAll`-app instance over the 5-per-window magic-link
throttle (it had been sitting exactly at the limit with its original
five calls), fixed by converting it to a fresh app per test
(`beforeEach`/`afterEach`), the same class of fix several other e2e
specs already needed. 292 api unit tests, 125 e2e tests (123 passing
+ 2 pre-existing unrelated skips) all green; `api` build/lint clean.

**Phase 25, issue #252 (engineering blog)** —
`wiki/blog/phase-25-bulk-process-submission-api/` gained one post for
issue #251, covering why the atomic-rollback decision (D49) was
simpler than the issue's own framing suggested (D13's rate limit was
never actually a rejection path), why sequential entity creation is
load-bearing for the rolling rate-limit check, and the
`sessions-on-write-path.e2e-spec.ts` throttle fix it surfaced.
`wiki/blog/README.md`'s index updated.

**Phase 25 is now fully done** — issues #251-252 both closed via
merged PRs, and every phase built so far now has a complete
engineering blog.

**Phase 26 planning (Client-Side Draft Wizard)** — given the size (a
genuine wizard rewrite: draft-state persistence, a new flashcard
navigation paradigm, a chronological review screen wired to Phase 25's
bulk endpoint), this went through Plan Mode before any code, same as
issue #248's expanded scope did. Implemented as three sequential PRs,
one per issue (#253 → #254 → #255), matching every other phase's
per-issue granularity.

**Phase 26, issue #253 (client-side draft state architecture)** — new
`web/src/lib/draft-store.ts`: a `ProcessDraft` type mirroring Phase
25's bulk-submission DTOs directly (`rounds`/`recruiterInteractions`/
`overallReview`, each round/recruiter step wrapped with a client-only
`clientId`) plus a client-only `timing: 'start' | 'end'` per recruiter
step (realizing issue #254's "Recruiter — Start"/"Recruiter — End"
vocabulary without a numeric position scheme — D50). Backed by one
versioned localStorage key (`interview-insights:drafts:v1`) holding
`Record<string, ProcessDraft>` — the first client-side persistence
anywhere in `web/`. Pure CRUD + add/remove-step helper functions, no
I/O side effects beyond the store itself. A draft never carries
`candidateId` (D31-consistent) and needs no session to edit at all —
only creating a brand-new company and the eventual bulk submit
(issue #255) are session-gated, which falls directly out of the design
rather than being deliberately engineered.

`web/src/app/page.tsx` rewritten: company pick-or-create (now using
the existing `GatedSection` component instead of a hand-rolled
tri-state conditional) → a "Your drafts" list (resume/delete) once any
exist → selecting/creating a company or resuming a draft opens a
minimal editor for the process-detail fields only (auto-saved on every
change), with a placeholder note where the old incremental round/
rating/recruiter/overall-review steps used to be — those return, backed
by the draft store, in issues #254/#255. `recruiter-overall-steps.spec.tsx`
(tested the now-removed incremental steps) deleted; `page.spec.tsx`
rewritten for the new flow. New `web/src/components/ErrorBanner.tsx`
extracted from its previous inline definition, since upcoming wizard
files need it too.

Found and fixed a real bug while testing, not just a test-environment
quirk: `crypto.randomUUID()` threw in jsdom, and on inspection also
requires a secure context in real browsers — which every one of this
project's deployed environments fails today (plain HTTP, non-`localhost`
origin, D27, no TLS yet). Fixed with a feature-detected `generateId()`
fallback (D50) — correct in both places at once, not a test-only shim.

9 new unit tests (`draft-store.spec.ts` — creation, reload-persistence,
two-simultaneous-companies non-corruption, ordering, delete, round/
recruiter step add/remove, corrupted-data tolerance) + `page.spec.tsx`
rewritten (6 tests) for the new company→drafts flow; 73 web tests
total, build/lint clean. Live-verified with a real headless-browser
(Playwright, installed ad hoc into an isolated scratch npm project to
avoid an `npx`-resolved version/browser-binary mismatch) against the
real `kind` cluster: anonymous visit shows the log-in prompt for
create-company: real magic-link login → company creation opens a
draft automatically → edited role title/outcome → full page reload →
drafts list shows the edit intact → resume shows the field correctly
pre-filled → delete removes the draft while the company itself
(correctly) still exists in the picker — zero console errors
throughout. Test data cleaned up afterward.

**Phase 26, issue #254 (flashcard-style step navigation)** — new
`web/src/app/wizard/` colocated components (not routes — no `page.tsx`
inside, so Next.js never treats the directory as one):
`step-navigator.tsx` (the free-jump step list — process details, every
round/recruiter step, overall review, each clickable in any order, plus
"add round"/"add recruiter touchpoint" controls), `round-step-form.tsx`,
`recruiter-step-form.tsx`, `type-metadata-fields.tsx` (a fully
registry-driven renderer for `text`/`controlled-single`/
`controlled-multi` fields — no per-round-type conditional, so a 9th
round type needs zero frontend changes), and `round-type-labels.ts`
(the one remaining place the 8 round types are named for display,
since the registry only provides field schemas, not labels).
`api.ts` gained `getRoundTypeFieldOptions()` (`GET /round-types/
field-options`, built in Phase 24 issue #248). Both round and recruiter
steps support an optional rating sub-section via a checkbox (a round
or touchpoint can exist in the draft with no rating yet, mirroring the
schema's own tolerance for that state, issue #260). Recruiter timing
(`'start' | 'end'`, D50) is editable in its form via a plain "before/
after your interview rounds" select. `page.tsx` wires it all in with a
two-column layout (`PageContainer` now `size="wide"` once a draft is
active) — step navigator on the left, the selected step's form on the
right.

10 new component tests (`wizard-step-navigation.spec.tsx` — two rounds
of the same type stay independent, removing one doesn't affect the
other, registry-driven fields render for the selected round type,
recruiter steps with different timings stay independent, a round with
its rating survives a reload) all green; 78 web tests total, build/lint
clean. Live-verified with a real headless browser (Playwright) against
the real `kind` cluster: real magic-link login → company creation
opens a draft → added a coding round (registry-driven `problemAlgorithms`/
`problemDataStructures` fields with real seeded options rendered) →
added a second round (system design) → navigated back to round 1,
title preserved independently → added a recruiter touchpoint → full
page reload → all three steps (2 rounds + 1 recruiter touchpoint)
survived intact — zero console errors throughout. Test data cleaned up
afterward. (Also hit and fixed a live-verification-only environment
issue, not a code bug: running the api and web dev servers in the same
shell invocation leaked the api's `.env`-sourced `PORT=3001` into the
web server's environment via `set -a`, causing a port collision —
fixed by starting each dev server in its own separate shell invocation.)

**Phase 26, issue #255 (chronological review screen + bulk-submit
integration)** — new `web/src/app/wizard/review-screen.tsx`: every
filled step in chronological order — recruiter steps with
`timing: 'start'` first (in add-order), then rounds sorted by their
own `sequenceNumber`, then `timing: 'end'` recruiter steps, then the
overall review last, always. This is a display-only merge; the
submitted payload keeps `rounds`/`recruiterInteractions` as the two
separate arrays the bulk endpoint already expects — no translation
step. Each row has an "Edit" link that jumps straight back to that
step via the navigator (issue #254), and the Submit button itself is
the only thing on the whole draft flow gated behind login
(`GatedSection`, reusing the same tri-state session-hint pattern as
everywhere else) — picking a company and filling out an entire draft
anonymously is fully supported, exactly as issue #253 set up.

`api.ts` gained `createBulkProcess()` (`POST /companies/:companyId/
processes/bulk`) plus the matching `CreateBulkProcessInput`/
`CreateBulkRoundInput`/`CreateBulkRecruiterInteractionInput` types
mirroring the backend DTOs field-for-field. Submitting strips every
client-only field (`clientId`, `timing`) by just mapping each step
wrapper down to its inner `round`/`interaction` object. Because D49
already guarantees the bulk endpoint is fully atomic, issue #255's
"handle a partial rejection" requirement simplified to: any failure
leaves the draft completely untouched and shows the error via
`ErrorBanner`; only a real success clears the draft and shows a
summary card listing exactly which entities were created and that
they're all `pending` — reusing the same status framing `/me` already
established, computed from the draft's own local counts (no need for
the bulk endpoint to echo back nested rows).

10 new component tests (`wizard-review-submit.spec.tsx` — chronological
sort with steps filled out of order, an edit link jumps back correctly,
successful submit clears the draft and shows the right summary, a
failed submit leaves the draft intact, the submit button specifically
is gated behind login while the review content stays visible) all
green; 83 web tests total, build/lint clean. Live-verified with a real
headless browser (Playwright) against the real `kind` cluster end to
end: real magic-link login → company creation → process details →
two rounds (one rated, one deliberately left unrated, to prove that's
fine) and two recruiter touchpoints added in deliberately non-
chronological order → overall review → a full page reload mid-draft,
resumed successfully → the review screen showing the correct
chronological order → a real submit → confirmed via direct Postgres
queries that exactly 2 rounds, 1 round rating, 2 recruiter
interactions, 1 recruiter rating, and 1 overall review landed, all
`pending` — zero console errors throughout. Test data cleaned up
afterward.

**Phase 26, issue #256 (engineering blog)** —
`wiki/blog/phase-26-client-side-draft-wizard/` gained one post per
feature issue (#253, #254, #255), covering the draft-store-mirrors-
the-bulk-DTO design and the `crypto.randomUUID` secure-context finding
(D50), the registry-driven flashcard step forms and the start/end
recruiter timing model, and the chronological review screen's
atomic-submit simplification (D49) and submit-only session gating.
`wiki/blog/README.md`'s index updated to match.

**Phase 26 is now fully done** — issues #253-256 all closed via merged
PRs, and every phase built so far now has a complete engineering blog.
The wizard a candidate uses today (client-side draft state, free-jump
flashcard navigation, a chronological review screen, one atomic bulk
submit) no longer resembles the incremental, immediately-writing one
this project shipped in Phase 2.

**Phase 28 planning (Wizard UX Refinements)** — filed 2026-07-25 from a
batch of live-verification findings against the Phase 26 wizard: a
meaningless raw class-validator error message on submit
(`recruiterInteractions.0.recruiterIdentifier should not be empty`),
round ratings requiring an opt-in click per round (now defaults to
available), no way to advance through steps without returning to the
navigator, a missing "Tech Screening" round type, recruiter step
wording issues ("before/after rounds" -> "pre-interview/post-interview",
and an editable "When was this?" select that should just read-only
reflect the timing already chosen at add-time), no tooltips explaining
the recruiter trait fields, and `Round.title` being both mandatory and
displayed as the literal word "untitled" when empty (should be optional,
formatted as "{Type} - {Title}" with the title segment omitted
entirely when absent). Milestone "Phase 28 — Wizard UX Refinements",
epic #280, issues #281-288 filed together per the "plan a phase before
implementing" convention; one clarifying question resolved directly
with the project owner before filing (default-checked rating vs. no
checkbox at all vs. something else — "default it to checked" chosen).
Implementation starting now, sequentially per issue.

**Phase 28, issues #281-287 (implementation)** — all seven feature
issues implemented and verified (unit/e2e/component tests + build/lint
clean on each): #281 client-side pre-submit validation + a humanizer
for any backend error shape that still reaches the UI; #282 rounds
default to an available (checked) rating; #283 a "Next" button
advancing process -> rounds -> recruiter steps -> overall -> review;
#284 a new `tech_screening` round type (two migrations — enum value,
then its seeded `round_type_field_options` in a separate migration,
since Postgres won't let a newly added enum value be used in the same
transaction that added it); #285 recruiter step wording renamed to
pre-interview/post-interview + its timing made read-only; #286
tooltips for each recruiter trait; #287 `Round.title` made optional,
with a new shared `formatRoundLabel()` util applied everywhere a round
is displayed (also fixed a real pre-existing bug this surfaced: the
moderation queue's round segment was gated on `roundTitle` truthiness,
so a round with no title wouldn't show its round type either — now
gated on `roundType`). #281-284 merged via CI-verified PRs (#290-293).

**CI billing gap (standing, until the user says otherwise)** — a
GitHub Actions billing issue on this account ("recent account payments
have failed or your spending limit needs to be increased") blocks
every GitHub-hosted job (`api`/`web`/`workers`/`infra` in `ci.yml`)
from starting at all — confirmed 403/job-not-started, not a code
failure. The user's explicit direction: keep implementing, keep
opening PRs, and **merge without waiting for CI** until notified the
billing limit is refreshed — this repo has no branch protection
anyway (issue #18, free-plan limitation), so nothing actually gates a
merge on checks passing. `cd.yml`'s `deploy` job runs on the
**self-hosted runner** (issue #88), which is unaffected by this
billing gap — CD kept deploying successfully through every merge in
this window (confirmed via `api/health`'s `version` matching each
merge SHA), so no manual local deploy step was actually needed on top
of it. Local `npm test`/`lint`/`build` (both `api` and `web`) remain
the real correctness gate while this lasts. PRs #294-297 (issues
#285-287 + a docs status update) all merged this way. One real wrinkle
found doing this: issue #286's branch had been created directly off
#285's branch rather than off `main` (a `git checkout -b` run from the
wrong starting branch), so its PR was silently stacked on #285's
commit — harmless once merged in order, but issue #287's branch was
made correctly from `main` and needed one real conflict resolution
(a shared test file edited by both #285 and #287 on the same line)
once #285/#286 had already landed ahead of it. That same conflict
resolution (PR #296) silently reverted several already-correct
`wizard-step-navigation.spec.tsx` assertions back to their pre-#287
content, despite git not flagging them as conflicts — not caught until
a direct check (running the tests against `main`'s actual committed
state, not just the working tree at merge time) showed 5 of 6 tests in
that file genuinely failing. Fixed in a follow-up PR (#298) that
restored the correct assertions; every other file in the #285/#286/#287
merge chain was confirmed unaffected by diffing each one individually
against its pre-merge commit.

**Phase 28, issue #288 (engineering blog)** —
`wiki/blog/phase-28-wizard-ux-refinements/` gained one post per feature
issue (#281-287), covering the block-first/humanize-what-slips-through
design for validation errors, the default-available round rating as a
one-line high-leverage fix, the live-recomputed "Next" sequence
alongside free-jump navigation, the two-migration shape a new enum
value plus its seeded options requires, the read-only recruiter timing
fix, the trait tooltips matching Phase 24's field-redesign definitions,
and optional round titles' shared `formatRoundLabel()` helper
(including the real pre-existing moderation-queue bug it surfaced).
`wiki/blog/README.md`'s index updated to match.

**Phase 28 was declared fully done, then reopened once more** — a
user question about why the wizard's write path isn't session-gated
(answer: Phase 26's deliberate design — a draft is pure client-side
state until the one atomic submit) surfaced a real related gap: the
candidate session (and its hint cookie) expire a fixed 1h after login
with no sliding renewal, but the wizard's `candidateSession` state was
only ever checked once at mount. A candidate spending over an hour on
a multi-round draft could keep seeing Submit as available long after
the session actually died, then hit a misleading generic
validation-error message on submit instead of being told to log back
in. **Issue #301** fixed this: `candidateSession` is now polled every
30s (a cheap cookie read, no network call); a logged-in -> logged-out
transition shows a warning banner on every step of the active draft
("Your session has expired... your draft is saved and won't be
lost"), clearing automatically once logged back in. The review
screen's existing `GatedSection` already re-hides Submit once the
state goes live — no separate fix needed there. Defense in depth: a
submit that still reaches the network with an expired session (a
timing edge case between polls) is now caught via `status === 401`
specifically and shown the same clear message instead of issue #281's
generic fallback. The draft itself is never touched by any of this.
4 new component tests (fake-timer-driven: proactive detection,
never-logged-in no-op, re-login clears the warning, the reactive 401
path) — 100 web tests total. Epic #280 reopened and re-closed the same
day, same precedent as every other epic reopening in this project.
`wiki/blog/phase-28-wizard-ux-refinements/issue-301-session-expiry-warning/`
added; `wiki/blog/README.md`'s index updated.

**Phase 28 was declared fully done, then reopened a third time** — a
batch of three more follow-ons from live discussion of the wizard: (1)
round rating traits (difficulty/fluency/clarity/focus/technicalDepth)
had no tooltip at all, only recruiter traits did (issue #286); (2) the
"Next" button (issue #283) could silently skip past adding a round
entirely, since the sidebar's separate "Add a round" control was easy
to never notice; (3) the user's requested fix for #2 also asked for
draft validation to become genuinely modular, plus two new rules —
never accept a submission with zero rounds, and remind (never force)
on a missing pre/post-interview recruiter touchpoint.

**Issue #305 (tooltip redesign)** — new `HelpTooltip` component: a
small "?" button, state-driven (not pure CSS `:hover`) so it opens on
both hover and keyboard focus and is reliably testable. Applied to
every round trait (new one-sentence definitions matching Phase 24
issue #247) and every recruiter trait, replacing issue #286's
dotted-underline/`title`-attribute pattern for consistency.

**Issue #307 (modular validation + new rules)** — `validateDraft()`
refactored from one function into a list of independent rule
functions combined via `.flatMap()`, so a future rule is just one more
function added to the list; every existing rule's behavior is
unchanged. New hard rule: a draft with zero rounds can never submit.
New soft reminders (a parallel, equally modular `collectDraftReminders()`
rule list): missing pre-interview or post-interview recruiter
touchpoints prompt a dismissible confirmation on the review screen
("+ Add now" creates the missing touchpoint with the right timing and
jumps straight into editing it; "Submit anyway" proceeds) — never a
hard block.

**Issue #306 (Next-button add-round modal)** — clicking Next now opens
a modal instead of navigating directly whenever doing so would leave
round-adding territory for the first time (Process Details with zero
rounds, or the last existing round); offers Add round / Finish draft &
go to review / No, continue (the original Next behavior, needed once
an existing recruiter/overall step should still just be advanced to
normally — the first two-choice design broke exactly that case). Next
is also blocked entirely while the current step has its own validation
issue, same guarantee Submit already has — except issue #307's
"at least one round" rule specifically, since that's a whole-draft
completeness fact, not a defect of the process step itself; blocking
Next on it would trap a candidate exactly where the modal exists to
help. `DraftValidationIssue` gained a stable `id` per rule to make
that exclusion explicit rather than message-matching.

19 new web tests across the three issues (110 -> 114 -> back up
through each PR); `wiki/blog/phase-28-wizard-ux-refinements/` gained
posts for #305-307; `wiki/blog/README.md`'s index updated. Epic #280
reopened and re-closed the same day, same precedent as every other
epic reopening in this project.

**Phase 28 was declared fully done, then reopened a fourth time
(GitHub issue #319)** — the user asked for several concrete wizard
changes together: moderators seeing every candidate data point (see
Phase 29 below), a consistency/rate-limit audit, and three direct UI
requests. The first two UI requests (round-type reordering/default/
validation, button renames) landed alongside a third the user
described in the same breath: remove the sidebar's original "Add a
round" control now that issue #306's Next-button modal exists — two
working paths to the same action was itself confusing, not a
neutral redundancy. Fix: the sidebar's round-type select + "Add
round" button are gone entirely (its two recruiter add-step buttons
are untouched); the modal's own select is reordered to match a
typical interview loop (Tech Screening/Assessment/Take-home first,
Other last) and defaults to an unselected "None" with "Add new round"
disabled until a real type is picked; "Add round" renamed to "Add new
round" (label only); "No, continue" renamed to "Cancel" *and*
re-behaviored — it no longer navigates anywhere (it used to advance to
whatever Next would have done normally), since that fallback made
sense only while the sidebar shortcut still existed. Verified the
capability wasn't actually lost: adding a round from any position is
still reachable via the free-jump navigator (go to the last round or
Process Details, then Next). 12 new/updated web tests across 6 files
(117 total) — every existing test that used the removed sidebar button
was rewritten to add rounds via the modal instead. Live-verified
end to end against the real cluster: sidebar control gone, select
defaults to None with the button disabled, order correct, Cancel
doesn't navigate, adding a Tech Screening round works — zero console
errors. `wiki/blog/phase-28-wizard-ux-refinements/
issue-319-consolidate-round-adding/` added. Epic #280 reopened and
re-closed the same day, same precedent as every prior reopening.

**Phase 29 — Moderator Full Content Visibility & Submission
Consistency (in progress)** — filed the same day, from the
same user request. An investigation (read-only Explore agent)
confirmed three real gaps: (1) `ModerationService.listPending()`
fetches a round's full `Round` row but only surfaces `title`/
`roundType` plus the rating fields — `description`, `typeMetadata`
(the round-type registry's structured answers — arguably the most
important content to actually moderate), `scheduledDurationMinutes`,
and any interviewer display label are fetched then silently dropped,
never reaching the moderator; recruiter ratings and overall reviews
have no such gap. (2) `ModerationQueueEntity.roundTitle` is typed
`string` (no `| null`) in `web/src/lib/api.ts`, inconsistent with
`CompanyReviewItem`/`MySubmissionRoundRating`, both correctly
`string | null` — not a runtime bug (the frontend already handles
`null`), but a real type-safety gap. (3) `FraudChecksService`'s rate
limit (3 ratings/rolling 24h, per candidate, non-blocking — only
flags the moderation queue entry) counts `round_rating` rows only;
`recruiter_rating` and `overall_review` creation (single-create and
bulk-submission paths alike) have zero fraud-check wiring at all —
D13 scoped this to round ratings when they were the only write path
that existed, never revisited once Phase 14 added the other two.
Milestone "Phase 29 — Moderator Full Content Visibility & Submission
Consistency", epic #314, issues #315-318 filed together (moderation
queue full-content enrichment; the `roundTitle` type fix; extending
rate limiting to recruiter ratings/overall reviews, with two kickoff
questions flagged for whenever implementation starts — a shared
rolling-window counter across all three entity types vs. three
independent ones, and whether duplicate-text detection should extend
too; engineering blog). Planned first; implementation on #315 started
the same session per the user's explicit confirmation ("Implement
#315 now") once a concrete follow-up request (the moderation queue's
information architecture, see below) needed a real decision on
whether to fold into this already-"planning only" phase or wait.

**Phase 29, issue #315 (moderation queue: full round content +
group by submission)** — expanded mid-implementation, per direct user
feedback: the original ask was "surface more round fields"; the user
then described the queue's real problem directly — a multi-round
submission repeated the same "Company · Role" context once per
round/rating/review (a real 5-row example: "Amazon · SSE" five times
over), and asked for one list item per submission instead, expanding
to full detail on click. `ModerationService.listPending()` rewritten:
new `ModerationQueueEntity`/`ModerationQueueEntry`/
`ModerationQueueGroup` interfaces replace the previously untyped
inline shapes; every entity type's enrichment now also carries
`processId` (round_rating additionally gains `roundDescription`,
`roundTypeMetadata`, `roundScheduledDurationMinutes` — this issue's
original ask); the previously-flat `enrichedEntries` array is grouped
into a `Map<string, ModerationQueueGroup>` keyed by `processId`
(a synthetic `unknown-${entry.id}` key covers the pre-existing D37
transient-failure case, so a failed enrichment still surfaces as its
own standalone group rather than disappearing), returned as
`ModerationQueueGroup[]` — `Map` insertion order keeps groups in the
same createdAt-ascending order the flat list always had. The existing
`Promise.allSettled` per-entity-type isolation (D37) is preserved
unchanged underneath the new grouping. Both kickoff questions resolved
directly rather than left open: `typeMetadata` renders as plain
key/value pairs (the registry's stored values, e.g. `["DFS", "BFS"]`
for `problemAlgorithms`, are already the human-readable display
strings — no ID-to-label lookup layer exists anywhere in this schema);
an interviewer display label was judged out of scope entirely — `Round.
interviewerId` has no write path anywhere in the codebase today
(`CreateRoundDto` has no interviewer field, `RoundsService.create()`
never sets it), so there's no data to enrich with, and building
interviewer-identity capture would be a materially larger, separate
feature (Phase 14's recruiter-identity capture is the closest analog).

On `web`: `web/src/lib/api.ts` gained the matching `ModerationQueueGroup`
type and `ModerationQueueEntity` gained the three new round-content
fields plus `processId` (and, opportunistically, `roundTitle`'s type
fixed to `string | null` while the type was already being touched —
closing issue #316's own gap early, since it's the same file/type).
`web/src/app/moderation/page.tsx` restructured: one collapsed `Card`
per group showing company/role and a pending-item count, expanding on
click (local `Set<number>` of expanded indices) to reveal each entry's
full detail — a new `RoundContentDetails` component renders
`roundDescription`/`roundScheduledDurationMinutes`/`roundTypeMetadata`
beneath the existing score line for round_rating entries only.
Approve/reject/flag still act per-entry; a group collapses out of the
list entirely once its last entry is resolved.

12 new/updated api unit tests (`moderation.service.spec.ts` — grouping
by shared `processId`, separate processes producing separate groups,
the D37 transient-failure case now also asserted per-group, plus the
new content fields) — 294 api unit tests total, all green. A new e2e
test in `moderation.e2e-spec.ts` proves grouping against real Postgres
(two round ratings under one process land in the same group; a second
process's own rating lands in a separate group); every other e2e spec
that reads `GET /moderation/queue` (`golden-path.smoke-spec.ts`,
`bulk-process-submission`, `update-delete-moderated-content`,
`company-reviews`, `recruiter-ratings`, `gdpr-erasure`,
`review-search`, `fraud-checks`, `me-submissions`, `overall-reviews` —
10 files) updated to flatten groups before searching for a specific
entity, via a shared `test/support/moderation-queue.ts` helper for new
code and matching inline `QueueGroupBody` types for existing files'
established per-file style — 127 e2e tests total (2 pre-existing
unrelated skips), all green. 10 new/updated web component tests
(`moderation-page.spec.tsx` rewritten for the grouped/expandable UI) —
118 web tests total, all green. `api`/`web` build/lint clean.

Live-verified against the real `kind` cluster (Postgres/OpenSearch/
Mailpit via the persistent port-forward script, D-series precedent):
logged in via a real magic link, created a company with one process
carrying two round ratings (one with a real description/duration/
typeMetadata) plus a recruiter rating, confirmed via the admin API
that `GET /moderation/queue` returned exactly one group with all
three entities nested under it, confirmed the round's full submitted
content (description, 45-minute duration, `{"problemAlgorithms":
["DFS","BFS"]}`) all reached the response, approved one entry and
confirmed the group correctly dropped to two remaining entries. Also
confirmed directly against the cluster's own pre-existing dev data:
the user's original "Amazon · SSE" 5-row example collapsed to exactly
one group of 5 entries. Test data cleaned up afterward via the real
`DELETE /me` GDPR-erasure endpoint plus a direct company/recruiter
delete and the existing `prune-orphaned-company-search-docs` script
(D51's own tooling), confirming zero orphaned rows or search
documents were left behind.

**Phase 29, issue #316 (`ModerationQueueEntity.roundTitle` type fix)**
— confirmed redundant, not implemented separately. #315's own rewrite
of `ModerationQueueEntity` in `web/src/lib/api.ts` (adding `processId`/
`roundDescription`/`roundTypeMetadata`/`roundScheduledDurationMinutes`)
touched the same `roundTitle` line and already changed it from
`string` to `string | null` (commit a5fda25, PR #323) — verified both
sides match: the backend (`moderation.service.ts`) already declares
and sets `roundTitle?: string | null` from the genuinely nullable
`Round.title` (#287), matching `CompanyReviewItem`/
`MySubmissionRoundRating`'s existing correct typing. Closed on GitHub
with the diff cited, no dedicated PR.

**Phase 29, issue #317 reframed before implementation (D52)** — while
discussing #315's grouping, the user asked whether moderation/rate-
limiting should be scoped per-entity or per-submission. Answer differs
by concern: moderation actions (approve/reject/flag) stay per-entity
— #315's own live data showed why (a real submission had 3 coding-round
ratings, 2 clean and 1 auto-flagged, needing independent moderator
decisions). But the fraud-check rate limit was reframed, not just
extended: `FraudChecksService.checkRateLimit()` counts `round_rating`
rows per candidate per rolling 24h — 3 trips it — but Phase 25/26 built
this platform specifically so one legitimate submission can contain
several rounds, so a single genuine submission could trip its own
"abuse" signal. That's exactly what the live data showed: the 3rd round
rating in one real 5-entity submission was auto-flagged purely for
being the candidate's 3rd rating that day. #317's issue body and title
were updated to reflect the new design: count `InterviewProcess`
creations (submissions) per candidate per rolling 24h window instead of
individual entities, applied uniformly across all three entity types —
which also resolves #317's original "shared vs. per-type counter"
kickoff question by making it moot. Duplicate free-text detection
(the other, count-independent half of `FraudChecksService`) still
extends to `recruiter_rating.freeText`/`overall_review.reviewText` as
originally planned.

**Phase 29, issue #317 implemented** — `FraudChecksService.
checkRateLimit()` now counts `tx.interviewProcess.count()` per
candidate per rolling 24h window (renamed constant
`RATE_LIMIT_MAX_SUBMISSIONS`), replacing the old `roundRating.count()`.
`checkDuplicateFreeText()`/`detectFlagReason()` both gained a
`ModerationEntityType` parameter (reusing the existing Prisma enum
rather than inventing a new type) and a new private
`fetchExistingFreeText()` switches on entity type to scan the correct
table/field (`roundRating.freeText`, `recruiterRating.freeText`, or
`overallReview.reviewText`) — each type's duplicate check is scoped to
its own field, never cross-type. `RecruiterRatingsService`/
`OverallReviewsService` gained `FraudChecksService` as a constructor
dependency (new for both — previously round-rating-only) and their
`create()` methods now call `detectFlagReason()` before creating the
entity, same shape as `RoundRatingsService.create()`; both modules
gained a `FraudChecksModule` import. `BulkProcessSubmissionService`'s
round-rating call gained the entity-type argument, and recruiter-
rating/overall-review creation gained fraud-check wiring they never
had before. 11 fraud-checks unit tests + 6 new/updated tests across
the three services' + bulk-submission's spec files (301 api unit tests
total) and a rewritten `fraud-checks.e2e-spec.ts` (8 tests, 134 e2e
total) all green — including a new test proving the exact bug D52
described is fixed (4 round ratings within one submission never trip
`rate_limit`) and tests proving the rate limit/duplicate detection now
apply identically to recruiter ratings and overall reviews, scoped
per entity type. `api` build/lint clean.

Live-verified against the real `kind` cluster (Postgres/OpenSearch/
Mailpit via the persistent port-forward script): created 3 separate
submissions for one candidate, rating each in turn — confirmed via
both a direct Postgres query and the live `GET /moderation/queue`
response that the first two submissions' round ratings were clean and
the 3rd was flagged `rate_limit`, exactly matching the new design.
Test data cleaned up afterward (direct erasure of the verification
candidate/processes plus the `prune-orphaned-company-search-docs`
script for a few stray companies from an earlier mis-ordered
verification attempt).

**Phases 30-32 planning (Event-Driven Foundation; Notification Service;
Review Analyzer Service)** — filed 2026-07-25 from a user brainstorm
about shifting toward event-driven microservices (notification-service,
review-analyzer, moderator-service each came up). Deliberately revisits
`docs/DECISIONS.md` D12 ("moderation stays in-process, no event bus") —
recorded as D53: not because organic load now demands it, but because
the project owner wants real distributed-systems/microservices
practice, the same category of trigger Phase 10/11 already accepted for
LocalStack IAM/secrets work. Three phases planned together (mirroring
the "Phases 15-17"/"Phases 24-26" precedent of planning a tightly
sequential group in one pass), implemented strictly in order: Phase 30
(epic #327, issues #330-333) introduces Redpanda + a best-effort,
after-commit event-publishing pattern (matching D16/D17's OpenSearch
"never block the write" shape exactly) — no new deployable service yet,
and the synchronous write path (including `ModerationService.enqueue()`)
is unchanged. Phase 31 (epic #328, issues #334-337) builds
notification-service, the first real standalone microservice this
project ships — deliberately the lowest-risk extraction, since `mail/`
is already a clean-boundary module with no write-path dependencies.
Phase 32 (epic #329, issues #338-341) depends on Phase 19 issue #163
(LLM-assisted moderation triage, already planned, not yet built)
shipping first — review-analyzer ports that same logic into an async,
event-driven enrichment once both the logic and the event bus exist,
rather than inventing the analysis rules and the service-extraction
plumbing at the same time. A kickoff brainstorm (issue #338) is
flagged, not resolved, for three real open questions: whether
review-analyzer replaces or runs alongside `FraudChecksService`'s
existing synchronous checks (leaning toward alongside, as a secondary
arrives-later signal), which LLM/API to use, and data ownership
(shared Postgres vs. an API call-back). Moderator-service — the third
service named in the brainstorm — is deliberately **not** phased: no
concrete extraction trigger has fired, and Phase 29 just reshaped
`ModerationService` for exactly the opposite reason (keeping it a clean
bounded context in-place). D53 also notes that shipping Phase 31 fires
`docs/ROADMAP.md` Phase 8's own sub-area 8g trigger ("first real
Kafka/Redpanda consumer") for the first time — that gets its own
planning pass under Phase 8's existing menu once Phase 31 actually
ships, not pre-filed now; Phase 8f (observability) stays untriggered,
since its own trigger (first shared/staging deployment with real
traffic) still hasn't fired. All three epics are on the project board
at "Todo" — planning only, no implementation started yet.

**Phase 29, issue #318 (engineering blog)** —
`wiki/blog/phase-29-moderator-full-content-visibility/` gained one post
per feature issue (#315, #316, #317), covering issue #315's mid-
implementation scope expansion into grouping-by-submission and its two
resolved kickoff questions (typeMetadata renders as direct key/value
pairs; interviewer-label enrichment out of scope, no write path exists),
issue #316's redundant-with-#315 closure, and issue #317's reframing
from a straightforward extension into fixing a real rate-limit bug
(D52) — including why moderation stays per-entity while rate-limiting
moved to per-submission, and why the bulk-submission transaction needed
no special-casing for the new submission-count check.
`wiki/blog/README.md`'s index updated to match.

**Phase 29 is now fully done** — issues #315-318 all closed via merged
PRs (#316 closed without a dedicated PR, resolved as a side effect of
#315), and every phase built so far now has a complete engineering
blog.

Phase 27 (Admin Content Gateway) analyzed before implementing (per the
user's explicit request) — both feature issues were already well-
specified with no blocking questions.

**Phase 27, issue #263 (admin CRUD API)** — analyzed before
implementing (per the user's explicit request): both feature issues
(#263-264) were already unusually well-specified, with no blocking
questions to resolve. A new `AdminRoundTypeFieldOptionsController`
(`admin/round-types/...`, `@UseGuards(AdminJwtAuthGuard)`), deliberately
its own controller rather than added to the existing public
`RoundTypeRegistryController` — that one has no guard at all, and
admin routes need one, the same separation `ModerationController`
already models. `RoundTypeFieldOptionsService` gained
`listAllOptions()` (every value, active and inactive, for a round
type), `createOption()` (validates `fieldKey` is a real
`controlled-single`/`controlled-multi` field on that round type via a
new `assertControlledField()`, defaults `sortOrder` to one past the
current highest for that field when omitted), and `updateOption()`
(a plain `prisma.update()` — a missing id or a duplicate
`(roundType, fieldKey, value)` both already map to the right HTTP
status via the existing global `PrismaExceptionFilter`, no new app-level
checks needed). Reordering happens via repeated `PATCH .../field-
options/:id` calls updating `sortOrder`, not a dedicated bulk-reorder
endpoint — matching the issue's own scope (add/update/retire only).
21 new/updated unit tests (301 -> 308 api unit tests total) + 7 new
e2e tests (round-type-registry.e2e-spec.ts, 141 e2e total) prove:
unauthenticated 401 on every route; a new value appears immediately in
both the admin list and the public `GET /round-types/field-options`;
an unknown or free-text `fieldKey` is rejected (400); a duplicate value
409s; retiring a value (`isActive: false`) removes it from the public
endpoint while the row stays visible (and still `isActive: false`) in
the admin list; a non-existent id 404s on update. `api` build/lint
clean. Live-verified against the real `kind` cluster: added a real
`problemAlgorithms` value via curl, confirmed it appeared in the public
endpoint immediately, retired it, confirmed it disappeared from public
but stayed in the admin list — test data cleaned up afterward.

**Phase 27, issue #264 (admin UI page)** — a new
`web/src/app/moderation/round-type-options/page.tsx`, session-gated
identically to `moderation/page.tsx` (`GET /auth/admin/me` check,
redirect to `/moderation/login` on 401). A round-type `<select>`
(reusing `ROUND_TYPES`/`ROUND_TYPE_LABELS`) drives which round type's
controlled fields are shown — derived from the existing public
`GET /round-types/field-options` schema (filtering out `kind: 'text'`
fields, which have no admin-managed vocabulary at all) — combined with
issue #263's new admin listing endpoint for that round type's actual
rows. Each controlled field gets its own `FieldSection` card: every
value (active and inactive) with an inline editable value/sortOrder
pair and a Save button, a Retire/Reactivate toggle (the same `PATCH`
endpoint handles both directions of `isActive`, so one button suffices
rather than a separate reactivate flow), and an "add value" mini-form
at the bottom. Distinguishes "still loading," "no round type picked
yet," and "this round type has no controlled fields" as three genuinely
different empty states (Phase 9 issue #61 rule). Reachable from
`/moderation`'s header via a new "Manage round-type field options"
link, with a "Back to moderation queue" link on the new page closing
the loop — same pattern Phase 15 issue #142 established for company
profile/analytics.

7 new component tests (`round-type-options-page.spec.tsx`) cover the
session-gate redirect, the two empty states, loading existing values,
adding a new one, retiring one, and a retired value's own Reactivate
affordance — 125 web tests total, build/lint clean. Live-verified with
a real headless browser (Playwright, reusing an existing scratch
install) against the real `kind` cluster end to end: logged in as
admin, navigated to the new page via the header link, selected
"Coding," added a real `problemAlgorithms` value, confirmed it reached
the public endpoint, retired it, confirmed it left the public endpoint
while staying visible (and marked inactive) in the admin list,
navigated back to the moderation queue via the back-link — zero
console errors throughout. Test data cleaned up afterward.

**Phase 27, issue #265 (engineering blog)** —
`wiki/blog/phase-27-admin-content-gateway/` gained one post per feature
issue (#263, #264), covering the admin CRUD API's separate-controller
design and reuse of the existing 404/409 Prisma exception mapping, the
retire-never-delete decision (D47), and the admin UI's schema-derived
field list, single retire/reactivate toggle, and three distinct empty
states. `wiki/blog/README.md`'s index updated to match.

**Phase 27 is now fully done** — issues #263-265 all closed via merged
PRs, and every phase built so far now has a complete engineering blog.

**Phase 33 (Search-First Landing Page)** — filed retroactively,
2026-07-26, per the user's direct request: the landing page should be
for searching/browsing reviews, not writing one — the same category of
direct-request pivot Phase 21 (anonymous visitor soft-gating) already
used as precedent for getting its own phase. Milestone "Phase 33 —
Search-First Landing Page", epic #351, issues #352-353. Also checked
`/me` for the same flat-list problem #347 fixed (issue #349's finding)
— confirmed it's unaffected, grouped by process since Phase 17.

**Phase 33, issue #352 (swap landing page and wizard; company
selection moves upstream)** — `web/src/app/page.tsx` (`/`) and
`web/src/app/search/page.tsx` (`/search`) swap body content wholesale:
`/` becomes the two-step company/review search experience (previously
at `/search`), `/search` becomes the write-a-review wizard (previously
at `/`) — routes unchanged, only which component each renders. The new
`/` gains a quick-select company-button grid (every existing company,
one click) alongside the text search, the same visual pattern the
wizard's old picker used, relocated here since discovery is this
page's job now. The wizard's own company-picker button grid is removed
**entirely** — company selection for a new draft happens upstream
instead: a new "Write a review" link, on a selected search result and
on a company's public profile page, navigates to `/search?companyId=
...&companySlug=...&companyName=...`; the wizard reads these on mount
to resume an existing draft for that company (matched by `companyId`
against `listDrafts()`) or start a fresh one, then strips the params
via `router.replace('/search')` so a later reload lands on the plain
drafts list, not a repeat auto-start. `NavBar`'s "Search companies &
reviews" link is relabeled "Write a review" (still `/search`, which now
hosts the wizard) — no separate nav entry added for search, since the
brand-mark Home link already goes to `/`.

`useSearchParams()` requires a `<Suspense>` boundary in the App Router
(a hard build error otherwise) — the wizard's default export wraps its
real content component, same pattern `auth/verify/page.tsx` already
established. A real test-authoring bug surfaced along the way: a naive
mock returning `new URLSearchParams(...)` fresh on every call creates a
new object reference every render, re-triggering the company-handoff
effect on every re-render (not just mount) — this manifested as a
genuine test hang, not a flake, in the first pass at updating the
wizard-driving test files. Fixed by returning a stable, module-level
`URLSearchParams` instance from the mock instead, matching how real
Next.js actually memoizes `useSearchParams()`'s return value across
re-renders when the URL hasn't changed. Documented as D56.

Two page-level test files swapped content to match (`page.spec.tsx`
now tests the search UI + new quick-buttons; `search-page.spec.tsx`
now tests the wizard + the query-param company handoff, including a
dedicated test proving re-arriving with the same company resumes the
existing draft rather than creating a duplicate); all five wizard-
driving test files updated for the new query-param entry point instead
of a picker-button click; `nav-bar.spec.tsx` updated for the new link
text. 131 web tests total, build, lint all green. Live-verified with a
real headless browser (Playwright) against the real `kind` cluster:
landing page shows search + quick company buttons; NavBar shows "Write
a review"; selecting a company (via quick button or search) reveals a
"Write a review" link carrying the right query params; clicking it
lands on `/search` with the draft auto-started and the URL params
stripped; the wizard shows no company-picker; the company profile page
has its own "Write a review" link — zero console errors throughout.

**Phase 33, issue #353 (engineering blog)** —
`wiki/blog/phase-33-search-first-landing-page/README.md` covers the
landing-page/wizard content swap, the query-param company-handoff
design (and why the wizard's own picker was removed entirely instead
of kept as a fallback), the `useSearchParams()` Suspense-boundary
requirement, and the real test-authoring bug the query-param mocking
surfaced (a fresh `URLSearchParams` per call re-triggering the
company-handoff effect on every render, not just mount — fixed with a
stable module-level instance, matching real Next.js memoization).
`wiki/blog/README.md`'s index updated to match.

**Phase 33 is now fully done** — issues #352-353 both closed via
merged PRs, and every phase built so far now has a complete
engineering blog.

**Phase 34 planning (Write-a-Review Flow Refinements)** — filed
2026-07-25 from a batch of five direct UI/UX requests following Phase
33's search-first swap: homogeneous company-list rows ("Browse
reviews"/"View profile"/"Write a review" actions, applied identically
to search results and the quick-select button grid); dropping the
parenthesized "(view profile)" styling; removing NavBar's standalone
"Write a review" link entirely; and a search-failure-triggered
"request a new company" flow, deliberately unreachable except from a
zero-results search. Two clarifying questions resolved directly with
the project owner before filing: quick-select buttons get the same
3-action row shape search results do; and — a genuinely custom answer,
not a plain option pick — drafts must be gated behind candidate login
even though a draft is only localStorage, suggested (and adopted) a
dedicated `/drafts` route, and the wizard must not keep living at
`/search` (needs its own distinct route name). Milestone "Phase 34 —
Write-a-Review Flow Refinements", issues #357-361 filed under epic
#356.

**Phase 34, issues #358-359 (`/write-review` route + login-gated
`/drafts` page)** — implements D57. `web/src/app/search/page.tsx` (the
wizard, since D56) moved to `web/src/app/write-review/page.tsx`; the
`search/` directory (and route) no longer exists — browse/search
already lives at `/` since D56, so there's no third swap, just one
route retired. `/write-review`'s "no company context" state now only
redirects to `/`; the inline drafts list and create-company form are
removed from it entirely (they don't belong on a route whose only job
is "a company or draft was already chosen upstream"). It gained a
second query-param shape, `?draftId=X` (resume this exact draft),
alongside the existing `?companyId=&companySlug=&companyName=` —
`/drafts`'s Resume links use the former, every "Write a review" link
elsewhere still uses the latter. A real redirect-loop bug was found
and fixed while wiring the `?draftId=` path in: after the query-param
effect consumes context and calls `router.replace('/write-review')`,
the resulting empty `URLSearchParams` re-triggers the same effect,
which would otherwise incorrectly redirect home even with an active
draft — fixed with a `useRef` flag (`consumedContextRef`), not state,
checked before the redirect-home branch (D57 has the full reasoning).

New `web/src/app/drafts/page.tsx`: the drafts list, displaced from the
wizard, gated with the existing `GatedSection` component (same
visibility rule as `/me`'s "My reviews") — a presentation-layer gate
only, since `listDrafts()` itself needs no session. `NavBar` gains a
"My drafts" link (shown only when logged in) and loses its standalone
"Write a review" link entirely. `web/src/app/page.tsx` and
`web/src/app/companies/[slug]/page.tsx`'s "Write a review" links
updated to point at `/write-review`.

7 tests in the renamed `write-review-page.spec.tsx` (query-param
company handoff, draftId resume, no-context redirect, the
redirect-loop fix specifically) + 6 new `drafts-page.spec.tsx` tests
(login gate, empty state, listing, resume, delete, declined-delete) +
2 new `nav-bar.spec.tsx` tests (My drafts shown/hidden by session) +
5 existing wizard-driving test files fixed for the new import path/
router mock (`push` added alongside `replace`) and the drafts-list UI
having moved off this page entirely — 137 web tests total, build/lint
clean. Live-verified with a real headless browser (Playwright) against
the real `kind` cluster: real magic-link login, NavBar showed "My
drafts" and no "Write a review" anywhere, selecting a company and
clicking its "Write a review" link landed on `/write-review` with the
URL stripped and the draft auto-started, "Back to my drafts" was a
real link to `/drafts`, Resume there navigated back into the same
draft via `?draftId=`, Delete removed it, logging out both gated
`/drafts` behind a login prompt and hid "My drafts" from NavBar — zero
console errors throughout. Test candidate cleaned up via the real
`DELETE /me` GDPR-erasure endpoint afterward.

**Phase 34, issue #357 (homogeneous company-list rows)** — a new shared
`web/src/components/CompanyResultRow.tsx` renders the one row shape a
company is ever listed in: plain-text name + size bucket, a "Browse
reviews" button (does what clicking the name used to do — selects the
company for step 2), "View profile", and "Write a review" — used by
both the typed-search-results list and the quick-select grid, so the
two can no longer drift out of sync (previously the quick-select grid
was a single clickable name-only button with no profile/review-writing
links at all). Step 2's "Browse reviews for {company}" header dropped
its parenthesized "(view profile)" styling in favor of a plain "View
profile" link, textually and visually identical to the row links above.
3 test files updated/added (`page.spec.tsx` rewritten for the new row
shape and renamed "quick-select company rows" describe block, plus a
new `company-result-row.spec.tsx` unit-testing the shared component
directly) — 139 web tests total, build/lint clean. Live-verified with a
real headless browser (Playwright) against the real `kind` cluster:
quick-select rows show all three actions with the name as plain text
(no button), clicking "Browse reviews" reveals step 2, step 2's header
shows plain "View profile" with no parentheses, and a typed search for
"Amazon" shows the identical row shape as a second, independent match
alongside the quick-select row — zero console errors.

**Phase 34, issue #360 (search-failure "request a new company" flow)**
— a zero-results company search now shows a "Want to file a create
company request?" button alongside the existing empty state; clicking
it reveals a new "Request a new company" section on the same page,
reusing the Name/Slug/Size/"Create company" form that used to live in
the wizard's no-context state (moved here, not duplicated, per D57) —
copy rewritten for this context ("Your search didn't find X — add it
below so you can write a review for it. This creates the company
itself, not a review."), gated behind login via the existing
`GatedSection` component. The section is deliberately reachable only
from this button — never on page load, never from a nav link — and
resets whenever a new search runs. On successful creation, redirects
straight into `/write-review?companyId=...` for the new company, the
same query-param handoff every other "Write a review" link already
uses. 4 new `page.spec.tsx` tests (never shown on load, shown after a
failed search plus its own button click, login-gate prompt when
logged out, creation + redirect when logged in) — 143 web tests total,
build/lint clean. Live-verified with a real headless browser
(Playwright) against the real `kind` cluster: searched for a
nonexistent company, confirmed no section pre-emptively shown, clicked
the button to reveal it, confirmed an anonymous visitor sees the login
gate not the form, logged in via a real magic link, created the
company, and confirmed the redirect landed on `/write-review` with the
URL stripped and the draft auto-started — zero console errors. Test
company cleaned up directly via `kubectl exec` psql plus the existing
`prune-orphaned-company-search-docs` script (D51's tooling) to remove
its now-orphaned OpenSearch document, confirmed via a dry run first.

**Phase 34, issue #361 (engineering blog)** —
`wiki/blog/phase-34-write-a-review-flow-refinements/` gained one post
per feature issue (#357, #358-359 combined into one post since they
were implemented and merged together, #360), covering the shared
`CompanyResultRow` component and the name-stops-being-a-click-target
redesign, the `/write-review`/`/drafts` route split with the
redirect-loop `consumedContextRef` fix and the login-gated-but-not-
actually-session-tied `/drafts` design (D57), and the search-failure
create-company-request flow's copy/redirect design. `wiki/blog/
README.md`'s index updated to match.

**Phase 34 was declared fully done, then reopened once more (GitHub
issue #366)** — direct user feedback on issue #357's own result: giving
every quick-select company button (the "Or pick one directly" grid)
the full `CompanyResultRow` treatment (Browse reviews/View profile/
Write a review per row) made an already-long company list read as
repetitive, since the whole point of that grid was a fast, low-noise
shortcut. Fixed by reverting the quick-select grid back to plain,
name-only buttons — clicking one still selects the company for step 2,
unchanged — while the typed-search-results list keeps the full
homogeneous row shape issue #357 introduced. `page.spec.tsx`'s
"quick-select company rows" describe block reverted to its pre-#357
"quick-select company buttons" shape and assertions; `company-result-
row.spec.tsx` untouched, since the shared component itself didn't
change, only where it's used. 143 web tests, build, lint all green.
Live-verified against the real `kind` cluster via headless-browser
(Playwright): quick-select shows plain name-only buttons with zero
Browse-reviews/View-profile/Write-a-review noise, clicking one still
reveals step 2, and a typed search still shows the full 3-action row —
zero console errors. Epic #356 and milestone #31 reopened and re-closed
the same day, same precedent as every other epic reopening in this
project.

**Phase 34 is now fully done** — issues #357-361 and #366 all closed
via merged PRs, and every phase built so far now has a complete
engineering blog.

**Phase 35 planning (Moderated Company Creation & Moderator Search)**
— filed 2026-07-26, from direct user feedback on issue #360's
create-company-request flow: `POST /companies` has never been
moderation-gated (`Company` has no `candidateId`, so it was never on
Phase 16's write-path list; issue #217/D38 only added session + rate-
limit gating, not a moderation queue) — a real gap against CLAUDE.md
hard constraint #2. Separately, the moderation queue has no search/
filter capability at all. Four questions resolved directly with the
project owner before filing: `Company` gets a real `status` column
(reusing the existing `ModerationStatus` enum) rather than a separate
request table; the moderator's new fuzzy search is backed by a new
dedicated OpenSearch index over the moderation queue, not Postgres
trigram matching; the category filter is two buckets (interview-review
= round+recruiter+overall combined, vs. create-company), not four;
and a rejected company request's row is kept (`status: rejected`) for
an audit trail rather than deleted, permanently occupying its slug
unless an admin intervenes. Also motivated by the same change: issue
#360's auto-redirect into `/write-review` after creation no longer
makes sense once the created company is pending, not public — it's
replaced with a plain confirmation modal, no navigation. Milestone
"Phase 35 — Moderated Company Creation & Moderator Search", issues
#369-373 filed under epic #368. Epic on the project board at "Todo" —
planning only, no implementation started.

**Phase 35, issue #369 (company creation moves behind moderation)** —
`Company` gains a `status` column (Prisma migration, reusing the
existing `ModerationStatus` enum rather than a new one) plus a fourth
`ModerationEntityType` value, `company`; `CompaniesService.create()`
now enqueues via `ModerationService` instead of indexing to OpenSearch
directly (indexing moves to approval time); every public read path
(`findAll`/quick-select, `findBySlug`, the existence checks backing
`GET /companies/:id/reviews` and `.../analytics`) filters to
`status: approved`, 404ing a pending/rejected company exactly like one
that doesn't exist; `InterviewProcess` creation (both the single and
bulk endpoints) rejects a non-approved `companyId` with 404;
`ModerationService.review()`'s switch and `listPending()`'s enrichment
both handle the new entity type (a company request stands in its own
group, keyed by a synthetic `company-request-<id>`, since it has no
`InterviewProcess` to group under). Two direct-feedback refinements
folded in before implementation: `POST /companies`'s existing session
gate (issue #217/D38) is unaffected; and a duplicate request for a
still-**pending** slug now gets a distinct, friendly 409 ("already
requested, pending review — check back later") instead of the generic
unique-constraint conflict, checked via a pre-insert `findUnique`
lookup — an approved duplicate still gets the generic conflict, a
rejected one is left as the generic conflict for now (explicitly
unresolved). Per the earlier-resolved design decision, **a rejected
company's row is kept** (`status: rejected`) for an audit trail rather
than deleted — permanently occupying its slug. See D58 for the full
write-up.

16 existing e2e spec files updated to approve a company before using
it (a new shared `test/support/companies.ts` helper —
`createApprovedCompany`/`createPendingCompany`/
`findCompanyQueueEntryId` — centralizes the create-then-approve dance);
two files that seed a company via raw Prisma (bypassing the API
entirely) needed `status: 'approved'` set explicitly in their seed
data, the same "raw-Prisma seeding skips API-layer side effects" class
of gap D51 already hit once. A new dedicated
`company-moderation.e2e-spec.ts` (7 tests) covers the gate's own
business rules end to end: hidden from every read path, process
creation blocked, the rejected-row-kept behavior, and both duplicate-
slug cases. `moderation.e2e-spec.ts` also gained 3 tests mirroring its
existing per-entity-type coverage for the new `company` type. 326 api
unit tests (12 new: `CompaniesService`, `InterviewProcessesService`,
`BulkProcessSubmissionService`, `ModerationService`,
`FraudChecksService`'s now-exhaustive switch), the golden-path smoke
test (a new step "1b" approving the company before the walkthrough
continues), and 144 web tests (a new company-entry-type test on the
moderation page, plus `ENTITY_TYPE_LABEL`/a `CompanyRequestDetails`
renderer) all green; `api`/`web` build/lint clean. Live-verified
against the real `kind` cluster (local dev servers pointed at kind's
Postgres/OpenSearch/Mailpit, since the in-cluster `api` pod still runs
pre-merge code): full curl-driven walkthrough (create → hidden
everywhere → duplicate-pending 409 → process-creation 404 → approve →
visible + searchable + process-creation allowed; a second company
rejected → row kept with `status: rejected`, confirmed via direct
`kubectl exec` psql) plus a real headless-browser (Playwright) pass
through the actual moderation UI (login → expand the "Company creation
request" group → see its slug/size/industry detail → Approve → group
disappears → company now publicly searchable) — zero console errors.
Test data cleaned up afterward (GDPR erasure for the candidate, direct
company-row deletes, and the `prune-orphaned-company-search-docs`
script for the two approved test companies' OpenSearch documents).

- Next step: Phase 35 issue #370 (new moderation-queue OpenSearch index
  + fuzzy search endpoint) is next, followed by #371 (moderation UI
  search/filter), #372 (confirmation modal), #373 (blog, last). Phase
  19 (Content Quality & Synthetic Data, issues #162-165) and Phases
  30-32 (Event-Driven Foundation / Notification Service / Review
  Analyzer Service) remain planned but not started. Continue merging
  without waiting for CI until the user says the GitHub Actions
  billing limit has been refreshed.

## Open decisions still to make

- Exact value of `k` in the shrinkage scoring formula (start at 8, tune later)
- Retention/deletion policy for moderation queue + rejected content (GDPR
  erasure path)
- Whether/when to slice `company_overall_aggregates` by role or level
- Moderator queue SLAs (~48h to start), request assignment, and breach
  notifications (Phase 36, not yet planned — see docs/ROADMAP.md)
