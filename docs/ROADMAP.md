# Build roadmap

Phased so each step produces something testable before adding the next
layer of complexity. Update the checkboxes as you go — this is a good
companion to the "Current status" section in `CLAUDE.md`.

Each phase's planning pass (see CLAUDE.md Conventions — "plan a phase
before implementing any of it") files one issue per feature item below,
plus a final "write the engineering blog for this phase" issue, done last
once the rest are merged. See `wiki/blog/README.md` for the resulting
posts, organized by phase.

## Phase 1 — Foundation
- [x] Repo scaffold matching the layout in `docs/ARCHITECTURE.md`
- [x] Prisma schema + first migration implementing `docs/DATA_MODEL.md`,
      in the order listed under "Migration ordering"
- [x] Local Docker Compose (Postgres, Redis, Redpanda)
- [x] Engineering blog (`wiki/blog/phase-1-foundation/`, PR #33) — written
      after the fact, since this phase predates the blog-issue convention

## Phase 2 — Thin vertical slice
- [x] Create + Read for Company → InterviewProcess → Round → RoundRating, API
      only (Update/Delete intentionally deferred — see CLAUDE.md current status)
- [x] Minimal frontend flow to create/view one full slice end to end
- [x] Unit tests for validation logic
- [x] Integration tests against a real test Postgres (Dockerized)
- [x] Engineering blog (`wiki/blog/phase-2-vertical-slice/`, PR #34) —
      written after the fact, same reason as Phase 1

## Phase 3 — Trust & moderation
- [x] Moderation queue (GitHub issue #1) — runs in-process within `api` for
      now, not a separate `workers`/Kafka-consuming service; see D12 in
      `docs/DECISIONS.md` for why, and revisit once there's async load to
      justify decoupling it
- [x] Basic fraud checks (rate limiting, duplicate detection) before any
      launch traffic — see D3 in `docs/DECISIONS.md` (GitHub issue #2).
      Flags into `moderation_queue.flag_reason` rather than rejecting the
      write outright; see D13 for why and its known scaling limits
- [x] Candidate verification flow (GitHub issue #3) — single-use,
      expiring email-verification token flips `unverified` →
      `email_verified`; no actual email is sent yet (the token is returned
      directly), see D14 in `docs/DECISIONS.md`
- [x] Engineering blog (`wiki/blog/phase-3-trust-moderation/`, PR #35)

## Phase 4 — Analytics
- [x] Materialized views per `docs/DATA_MODEL.md` Aggregation layer section
      (GitHub issue #7) — approved-only, no refresh trigger yet, see D15
- [x] Shrinkage scoring implemented at the API layer (D4) (GitHub issue #8)
      — pure formula util + a `GlobalAveragesService` computing
      sample-size-weighted platform averages off the issue #7 views
- [x] `/companies/:id/analytics` endpoint (GitHub issue #9) — the
      "fall back to company-wide when a round-type slice is under the
      floor" nuance from `docs/DATA_MODEL.md` is deferred, not
      implemented (not required by this issue's acceptance criteria;
      adds real complexity — revisit once the dashboard, issue #10,
      or real usage shows it's needed)
- [x] Dashboard UI (company / round-type / recruiter views) (GitHub
      issue #10) — `web/src/app/companies/[companyId]/analytics/page.tsx`,
      reachable from the Phase 2 wizard once a company is selected
- [x] Engineering blog (`wiki/blog/phase-4-analytics/`, PR #36)

## Phase 5 — Search & discovery
- [x] OpenSearch indexing for company search (GitHub issue #21) —
      `infra/docker-compose.yml` default service (first real trigger, per
      D9); synchronous, best-effort indexing on company creation, see D16
- [x] Review search indexing (GitHub issue #22) — indexes an approved
      `round_rating` from `ModerationService.review()`, after commit;
      synchronous, best-effort, see D17
- [x] Filtering by role, round type, date range (GitHub issue #22) —
      `GET /search/reviews?q=&companyId=&roleTitle=&roundType=&dateFrom=&dateTo=`
- [x] Search UI (GitHub issue #23) — `web/src/app/search/page.tsx`: find a
      company via `/search/companies`, then filter its reviews via
      `/search/reviews` (role title, round type, date range); explicit empty
      states for zero-match searches on both steps (`EmptyState` component),
      never a silently blank list
- [x] Engineering blog (`wiki/blog/phase-5-search-discovery/`, PR #37)

## Phase 6 — CI/CD & containerization
- [x] GitHub Actions: lint, type-check, test, build on PR (built during
      Phase 1 scaffolding, ahead of sequence — `.github/workflows/ci.yml`)
- [x] Dockerfile per service (api, web, workers) (ditto)
- [x] Full-stack Docker Compose profile (GitHub issue #17) — fixed a latent
      `api/Dockerfile` bug (runtime stage relied on npx auto-installing the
      `prisma` CLI over the network) by copying the built `node_modules`
      wholesale instead of reinstalling with `--omit=dev`; migrations now
      apply automatically on container start; `docker compose --profile
      full up --build` for prod-like local testing, default `docker
      compose up` still just Postgres for the fast dev loop
- [ ] Branch protection on `main` requiring CI checks (GitHub issue #18) —
      **blocked**: both classic branch protection and repository rulesets
      require GitHub Pro (or a public repo) for private repos on the free
      plan; revisit if/when either changes
- [x] Engineering blog (`wiki/blog/phase-6-cicd-containerization/`, PR #38)
      — covers both #17 and #18 (a blocked issue still gets documented)

## Phase 7 — Kubernetes
- [x] Base manifests for Postgres + OpenSearch (GitHub issue #27) —
      `infra/k8s/base/`, StatefulSets + headless Services + PVCs,
      verified against a local `kind` cluster
- [x] Base manifests for `api` + `web` (Deployment, Service, Ingress,
      ConfigMap) (GitHub issue #28) — depends on #27; verified against a
      local `kind` cluster with an nginx Ingress controller
- [x] Kustomize overlays for dev/staging/prod (GitHub issue #29) — `dev`
      is the exact base config, formalized as an overlay and re-verified
      against the live `kind` cluster; `staging`/`prod` are structural
      only (separate namespace, 2 replicas for `api`/`web`, real resource
      values, per-environment Ingress hosts + `CORS_ORIGIN`, distinct
      image tags) until a real shared cluster exists (Phase 8 triggers)
- [x] Engineering blog (`wiki/blog/phase-7-kubernetes/`, PRs #39 and #44)
      — one post per issue (#27-#29); Phase 7's blog is complete

Moving to Helm is not a to-do here — it's a standing guideline, same
framing as Phase 8's trigger-gated items below. *Trigger: the
`infra/k8s/base/`+overlay manifests becoming genuinely repetitive across
services/environments — not the case yet with 2 app services (`api`,
`web`) and 2 stateful deps (Postgres, OpenSearch), and issue #29's
Kustomize overlays already solve the exact base-vs-environment
duplication problem Helm would otherwise be reached for.* Revisit only if
that changes; don't move to Helm speculatively.

## Phase 8 — Production hardening & platform scale-out

Not a day-one checklist — a menu, each item gated by an explicit trigger.
Building any of this before its trigger is exactly the "premature
infrastructure" docs/DECISIONS.md D9 warns against: it adds real operational
cost (things to run, patch, pay for, and debug) before there's a problem it
solves. Target cloud: **AWS** (D11) — every item below assumes that, with a
local-only emulation path noted so it can be prototyped at zero cloud cost.
[LocalStack](https://www.localstack.io/) emulates most of the AWS services
referenced below (Secrets Manager, IAM, S3, SQS) behind the real AWS SDK/CLI,
so `api`/CI can point at `http://localhost:4566` instead of real AWS during
local development — called out again where it's most relevant, but it's
useful across most of this phase.

**How this phase gets planned — deliberately different from every phase
before it.** CLAUDE.md's "plan a phase before implementing any of it"
convention means *file all the issues for a phase before implementing
any of them* — that's correct for Phases 1-7, where the whole phase's
scope is already known and worth doing. It does **not** mean file issues
for all 7 sub-areas below right now: none of their triggers have fired
(checked directly against this project's actual state as of Phase 7 —
still solo, still local-only `kind`, no AWS resources, no real traffic,
no cache reads/writes, no Kafka consumer anywhere). Filing implementation
issues for infrastructure with nowhere to run and nothing driving it
would be exactly the premature-infrastructure mistake D9 warns against,
just moved from code into the issue tracker instead. Instead: each
sub-area (8a-8g) is planned — issues filed under its own milestone, per
the normal convention — only once *that sub-area's own trigger* actually
fires. Until then, this document *is* the plan; there is nothing further
to plan today.

### 8a. CI/CD maturity
*Trigger: more than one contributor, or any deploy target beyond your own
machine.*
- Branch protection + required status checks (`.github/workflows/ci.yml`
  already produces the checks — just require them in GitHub repo settings)
- CD workflow separate from CI: auto-deploy `main` to staging, manual
  approval gate for prod (GitHub Environments + required reviewers)
- PR-triggered ephemeral preview environments (scoped DB schema + short-lived
  api/web instance per PR), torn down on PR close
- CI authenticates to AWS via OIDC federation (GitHub's OIDC provider → an
  IAM role scoped to exactly "push image, update service") — never long-lived
  AWS access keys sitting in repo secrets
- Local emulation: [`nektos/act`](https://github.com/nektos/act) runs the
  Actions workflow locally for fast iteration without pushing

### 8b. Secrets management
*Trigger: before anything touches real candidate data, or before any
shared/staging environment exists — not needed for solo local dev with
`.env` files.*
- AWS Secrets Manager for rotated/sensitive values (`EMAIL_HASH_SECRET`,
  `DATABASE_URL`); Parameter Store for cheaper, less-sensitive config
- Services fetch secrets at boot via their IAM task role — never baked into
  a Docker image or pasted into a CI variable
- Open question to resolve before this ships: rotating `EMAIL_HASH_SECRET`
  invalidates every existing `email_hash`, breaking candidate lookups —
  needs a dual-read migration strategy, not a hard cutover
- Local emulation: HashiCorp Vault in dev mode (`vault server -dev`), or
  LocalStack if you'd rather develop directly against the real
  `SecretsManagerClient` from the AWS SDK and swap only the endpoint URL for
  production

### 8c. Networking (VPC, ingress/egress)
*Trigger: first deploy to a shared/staging AWS environment — a single local
Postgres container has nothing to isolate.*
- VPC: public subnets hold only the load balancer; `api`, Postgres, Redis,
  and workers live in private subnets with no public IPs
- Security groups as the primary ingress control (api SG accepts 443 only
  from the ALB SG; Postgres SG accepts 5432 only from the api SG)
- NAT gateway for egress from private subnets — this bills hourly, so don't
  provision it until something in a private subnet actually needs outbound
  internet (e.g. calling an email provider)
- WAF in front of the ALB once there's public traffic, rate-limiting at the
  edge before requests reach `api`
- Local equivalent: docker-compose's bridge network already models this —
  only map `ports:` for services you're actively developing against; in a
  "prod-like" local run, drop Postgres's port mapping so only `api` can
  reach it over the compose network

### 8d. IAM
*Trigger: first AWS resource of any kind — get this right from day one,
unlike everything else in this phase.*
- One IAM role per service (api task role, worker task role, CI deploy
  role), each scoped to only what that service does — never a shared admin
  credential
- No IAM users with long-lived access keys for humans; IAM Identity Center
  (SSO) + short-lived STS sessions for anyone needing console/CLI access
- Mostly a habit, not infrastructure to stand up — but LocalStack can dry-run
  a role/policy JSON against its IAM emulation to catch typos in an ARN or an
  overly broad `Resource: "*"` before it's ever applied for real

### 8e. Redis / caching
*Trigger: Phase 3's fraud-check rate limiting, or Phase 4's aggregate
caching — don't add Redis before one of those actually reads/writes to it
(this is why it was removed from `infra/docker-compose.yml` in the first
place).*
- Managed: ElastiCache (Redis or Valkey) in the same private subnet as `api`
- Use for: rate-limiting candidate submissions (Phase 3), caching
  shrinkage-scored aggregates (Phase 4) with a short TTL and explicit
  invalidation on new approved ratings
- Local equivalent: `redis:7-alpine` back in `infra/docker-compose.yml`,
  added the same day the code first needs it

### 8f. Observability, logging, telemetry
*Trigger: first shared/staging deployment with real traffic — one developer
and one local Postgres doesn't need distributed tracing.*
- Structured JSON logs (NestJS logger → pino) shipped to CloudWatch Logs
  (or self-hosted Loki to cut cost)
- OpenTelemetry SDK instrumenting NestJS (HTTP + Prisma spans) → OTel
  Collector → AWS X-Ray or self-hosted Jaeger/Tempo
- Metrics via a Prometheus-format `/metrics` endpoint, scraped by Grafana
  Cloud or self-hosted Prometheus + Grafana
- Alerting on SLOs (p99 latency, 5xx rate) only once there's a baseline to
  alert against — don't wire up PagerDuty/Opsgenie before there's a metric
  worth paging on
- Local equivalent: a docker-compose profile with Prometheus + Grafana +
  Jaeger (or the Grafana "LGTM" all-in-one image) — genuinely worth running
  locally before this touches cloud billing at all

### 8g. Distributed systems hardening (Kafka/Redpanda consumers)
*Trigger: the first real Kafka/Redpanda consumer existing at all — none
does yet. This section originally assumed Phase 3's moderation queue and
Phase 4's aggregation views would become event-driven workers; neither
did (moderation stayed in-process, D12; views refresh on-read, D15), so
that framing was stale. This isn't new scope, just what "production
grade" means once *some* consumer exists — not gated on those two
specific features anymore.*
- Consumer groups so multiple worker replicas don't double-process the same
  event
- Idempotent consumers — a redelivered message must not double-count a
  rating in an aggregate
- A dead-letter topic for messages that fail processing repeatedly, so one
  bad message can't jam the whole topic

## Deferred until real usage data exists
- `normalized_band` / `company_level_mappings` population (D5)
- ClickHouse migration for analytics (only if materialized views strain)
- Tuning `k` in the shrinkage formula
- Everything in Phase 8, gated by the triggers listed there

## Phase 9 — UX/UI Polish Pass
Noticed running the app end-to-end after Phase 7: leftover dev-only
notes/placeholder copy, inconsistent styling, and general rough UX edges
across the Phase 2 wizard, Phase 4 dashboard, and Phase 5 search pages.
Audited (walked every page, checked the source directly) before filing
anything, same "plan before implementing" discipline as every other
phase. Milestone: "Phase 9 — UX/UI Polish Pass".

Numbered by when it was planned, not by execution order relative to
Phase 8 — Phase 8 remains trigger-gated (see its own intro) and may well
start later than this phase finishes; the numbers here just track
planning sequence, same as they always have.

- [x] Remove internal dev-note leaks and fix stale moderation copy
      (GitHub issue #57) — includes a factually stale claim ("expected to
      be empty until Phase 3's moderation worker exists"), not just
      unpolished text
- [x] Add persistent shared navigation across all pages (GitHub issue
      #58) — `web/src/components/NavBar.tsx`, rendered once from
      `web/src/app/layout.tsx`; every page keeps its own title/
      description, only the home/search links moved into the shared nav
- [x] Wizard: allow changing the selected company without a page reload
      (GitHub issue #59) — resets every dependent step (candidate,
      process, round, rating) so no stale data references the old company
- [x] Visual design pass: layout width and basic branding consistency
      (GitHub issue #60) — shared `PageContainer`/`Button` components make
      the width and accent-color decisions structural, not copy-pasted
- [x] Investigate ambiguous loading vs. empty states (GitHub issue #61) —
      confirmed live (delayed API responses) and fixed two real cases:
      the homepage's approved-ratings count showed "0" identically
      whether still fetching or confirmed zero, and the search page
      showed no indicator at all while a search was in flight (first
      search: indistinguishable from "haven't searched"; repeat search:
      stale previous results lingered with no sign a new one was
      running). The analytics dashboard already had a correct, distinct
      "Loading…" state — no fix needed there
- [x] Engineering blog (GitHub issue #68) — `wiki/blog/
      phase-9-ux-ui-polish/`; Phase 9 is now fully done

## Phase 10 — Cloud-Readiness Practice (Local, Free)
Local, zero-cost practice for cloud-shaped tooling ahead of any real
Phase 8 trigger firing — doesn't supersede D11 (AWS) and doesn't start
Phase 8 for real (see docs/DECISIONS.md D19/D20). Milestone: "Phase 10 —
Cloud-Readiness Practice (Local, Free)".

- [x] Install ingress-nginx via Helm instead of raw upstream YAML
      (GitHub issue #65) — third-party infra only; our own api/web/
      postgres/opensearch manifests stay on Kustomize, see D19
- [x] LocalStack: IAM policy validation + Secrets Manager integration
      path, not deployed (GitHub issue #66) — confirmed LocalStack's free
      tier covers IAM/Secrets Manager but not EKS (Ultimate-tier only);
      `kind` stays the compute layer regardless, see D20
- [x] Engineering blog (GitHub issue #69) — `wiki/blog/
      phase-10-cloud-readiness-practice/`; Phase 10 is now fully done

## Phase 11 — Integrated Prototype: LocalStack Secrets & IAM in `kind`

Filed after auditing the state of everything built so far (user's request,
2026-07-17): Phase 10's LocalStack work was explicitly practice-only (D20 —
"neither is wired into any actually-deployed path"), and Phase 7's Helm-
installed `ingress-nginx` has never run anywhere near LocalStack. Before
any real Phase 8 planning, this phase actually wires the two together —
the api pod in the `kind` cluster fetches its real secrets from LocalStack
Secrets Manager via an assumed IAM role, instead of a plaintext k8s
`Secret` — so there's one running environment where Helm, Kustomize,
Postgres, OpenSearch, search, moderation, analytics, and now
secrets/IAM all genuinely communicate together, not just each verified in
isolation. This is deliberately still local/free (no real AWS account,
doesn't retrigger D11) — see the new decision this phase adds in
`docs/DECISIONS.md`. Milestone: "Phase 11 — Integrated Prototype:
LocalStack Secrets & IAM in kind".

- [x] Deploy LocalStack (IAM + Secrets Manager only) into the `kind`
      cluster and seed the API's two secrets plus the existing
      `infra/aws/api-secrets-access-policy.json` IAM role (GitHub issue
      #78) — opt-in manifests, not part of the default `dev` overlay's
      baseline deploy
- [x] Wire `api`'s boot path to assume that IAM role via STS and fetch
      `DATABASE_URL`/`EMAIL_HASH_SECRET` from Secrets Manager before
      `NestFactory.create` runs (GitHub issue #79) — opt-in via config,
      plain-env-var default unchanged for `docker-compose`/fast local dev
- [x] End-to-end verification: redeploy the full `kind` cluster with the
      LocalStack-backed secrets path live, confirm the api pod boots
      without the plaintext `Secret`, and re-run the full Playwright
      golden path through the Helm-ingress-fronted `web` app (GitHub
      issue #80) — the adversarial check (corrupting the plaintext
      Secret) caught a real bug: the container's `CMD` ran migrations as
      a separate shell step that never saw the bootstrapped secrets;
      fixed with `api/scripts/entrypoint.js`, see D22
- [x] Engineering blog (GitHub issue #81) — `wiki/blog/
      phase-11-integrated-prototype/`; Phase 11 is now fully done
