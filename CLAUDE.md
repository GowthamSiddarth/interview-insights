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

As of 2026-07-18: Phase 1 (repo scaffold), Phase 2 (thin vertical slice),
Phase 3 (trust & moderation), Phase 4 (analytics), Phase 5 (search &
discovery), Phase 7 (Kubernetes), Phase 9 (UX/UI Polish Pass),
Phase 10 (Cloud-Readiness Practice, local/free), and Phase 11
(Integrated Prototype: LocalStack Secrets & IAM in kind) are all done.
Phase 6 is done except issue #18 (blocked). Phase 12 (Local CD &
Cluster Observability) is in progress: issues #88, #89, and #99 done
(self-hosted runner, CD workflow, dev-localstack wired in as CD's
default deploy target); #90 (k9s + metrics-server) and #91 (blog, last)
remain open. Phases 1-7 and 9-11 each have a complete engineering blog
under `wiki/blog/`; Phase 12's blog is pending its own issue (#91).
Phase 8 is a trigger-gated backlog, not started.

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
- Next step: Phase 12 issues #90 (k9s + metrics-server) and #91 (blog,
  last, once #88/#89/#99/#90 are all merged) remain open.

## Open decisions still to make

- Exact value of `k` in the shrinkage scoring formula (start at 8, tune later)
- Retention/deletion policy for moderation queue + rejected content (GDPR
  erasure path)
- Whether/when to slice `company_overall_aggregates` by role or level
