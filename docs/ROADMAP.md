# Build roadmap

Phased so each step produces something testable before adding the next
layer of complexity. Update the checkboxes as you go — this is a good
companion to the "Current status" section in `CLAUDE.md`.

## Phase 1 — Foundation
- [x] Repo scaffold matching the layout in `docs/ARCHITECTURE.md`
- [x] Prisma schema + first migration implementing `docs/DATA_MODEL.md`,
      in the order listed under "Migration ordering"
- [x] Local Docker Compose (Postgres, Redis, Redpanda)

## Phase 2 — Thin vertical slice
- [x] Create + Read for Company → InterviewProcess → Round → RoundRating, API
      only (Update/Delete intentionally deferred — see CLAUDE.md current status)
- [x] Minimal frontend flow to create/view one full slice end to end
- [x] Unit tests for validation logic
- [x] Integration tests against a real test Postgres (Dockerized)

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
- [ ] Dashboard UI (company / round-type / recruiter views) (GitHub issue #10)

## Phase 5 — Search & discovery
- [ ] OpenSearch indexing for company + review search
- [ ] Filtering by role, round type, date range

## Phase 6 — CI/CD & containerization
- [x] GitHub Actions: lint, type-check, test, build on PR (built during
      Phase 1 scaffolding, ahead of sequence — `.github/workflows/ci.yml`)
- [x] Dockerfile per service (api, web, workers) (ditto)

## Phase 7 — Kubernetes
- [ ] Local kind/minikube cluster with plain manifests
      (`infra/k8s/base`: Deployment, Service, Ingress, ConfigMap, Secret)
- [ ] Staging overlay via Kustomize
- [ ] Move to Helm only if manifests become genuinely repetitive across
      services/environments

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
*Trigger: Phase 3's moderation worker and Phase 4's aggregation worker are
the first real consumers — this isn't new scope, just what "production
grade" means once they exist.*
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
