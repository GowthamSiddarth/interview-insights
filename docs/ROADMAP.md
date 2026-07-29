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

*Predates the issue/milestone convention introduced in Phase 3 — every
item below was retroactively given its own closed GitHub issue purely
for citation consistency (same precedent as the blog issue below), not
because it was planned that way at the time. Retrofitted with an Epic
issue too once the Epics-vs-Milestones convention was adopted — no
Milestone exists for this phase (predates that too), just the Epic.
Epic: GitHub issue #170.*

- [x] Repo scaffold matching the layout in `docs/ARCHITECTURE.md`
      (GitHub issue #111)
- [x] Prisma schema + first migration implementing `docs/DATA_MODEL.md`,
      in the order listed under "Migration ordering" (GitHub issue #112)
- [x] Local Docker Compose (Postgres, Redis, Redpanda) (GitHub issue #113)
- [x] Engineering blog (`wiki/blog/phase-1-foundation/`, PR #33, GitHub
      issue #47) — written after the fact, since this phase predates the
      blog-issue convention

## Phase 2 — Thin vertical slice

*Also predates the issue/milestone convention — same retroactive-issue
note as Phase 1 above. Epic: GitHub issue #171.*

- [x] Create + Read for Company → InterviewProcess → Round → RoundRating, API
      only (Update/Delete intentionally deferred — see CLAUDE.md current
      status) (GitHub issue #114)
- [x] Minimal frontend flow to create/view one full slice end to end
      (GitHub issue #115)
- [x] Unit tests for validation logic (GitHub issue #116)
- [x] Integration tests against a real test Postgres (Dockerized) (GitHub
      issue #117)
- [x] Engineering blog (`wiki/blog/phase-2-vertical-slice/`, PR #34,
      GitHub issue #48) — written after the fact, same reason as Phase 1

## Phase 3 — Trust & moderation

Epic: GitHub issue #172.

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
      directly), see D14 in `docs/DECISIONS.md`. **Superseded by Phase 16
      issue #145** — the standalone endpoints this issue built
      (`POST /candidates/:id/verification-token`, `POST /candidates/verify`)
      were removed once magic-link login did the same job more securely
      (an actual email, a real session) — see D30.
- [x] Engineering blog (`wiki/blog/phase-3-trust-moderation/`, PR #35,
      GitHub issue #49)

## Phase 4 — Analytics

Epic: GitHub issue #173.

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
- [x] Engineering blog (`wiki/blog/phase-4-analytics/`, PR #36, GitHub
      issue #50)

## Phase 5 — Search & discovery

Epic: GitHub issue #174.

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
- [x] Engineering blog (`wiki/blog/phase-5-search-discovery/`, PR #37,
      GitHub issue #51)

## Phase 6 — CI/CD & containerization

Epic: GitHub issue #175 (spans both the original pre-convention work and
the later "Phase 6 hardening" milestone — a concrete example of an epic
not mapping 1:1 to a single milestone, see wiki/github-project-setup.md).

- [x] GitHub Actions: lint, type-check, test, build on PR (built during
      Phase 1 scaffolding, ahead of sequence — `.github/workflows/ci.yml`)
      (GitHub issue #118, retroactive — see Phase 1's note)
- [x] Dockerfile per service (api, web, workers) (ditto) (GitHub issue
      #119, retroactive — see Phase 1's note)
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
- [x] Engineering blog (`wiki/blog/phase-6-cicd-containerization/`, PR #38,
      GitHub issue #52) — covers both #17 and #18 (a blocked issue still
      gets documented)

## Phase 7 — Kubernetes

Epic: GitHub issue #176.

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
- [x] Engineering blog (`wiki/blog/phase-7-kubernetes/`, PRs #39 and #44,
      GitHub issue #53) — one post per issue (#27-#29); Phase 7's blog
      is complete

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
phase. Milestone: "Phase 9 — UX/UI Polish Pass". Epic: GitHub issue #177.

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
Cloud-Readiness Practice (Local, Free)". Epic: GitHub issue #178.

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
LocalStack Secrets & IAM in kind". Epic: GitHub issue #179.

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

## Phase 12 — Local CD & Cluster Observability

Filed after discussing, with the user, how to get real CD and cluster
visibility given the local machine is the only hosting target right
now (2026-07-17) — a distinct, narrower need from Phase 8a (CI/CD
maturity, gated on "more than one contributor or a deploy target beyond
your own machine") and 8f (observability, gated on "first shared/
staging deployment with real traffic"). Neither of those triggers has
fired; this phase doesn't start Phase 8, the same way Phase 10 didn't —
it's local practice/tooling scoped to what a solo, single-machine setup
actually needs. Two user decisions set this phase's scope precisely:
the self-hosted runner runs **on-demand** (started manually right
before a deploy, not a persistent always-on service — smaller standing
attack surface, since nothing executes repo-triggered code on the
machine unless a session explicitly turned the runner on), and the CD
workflow triggers **automatically on push to `main`** (a real `on:
push` trigger, not `workflow_dispatch`) — the job simply queues until
the on-demand runner is next started, reconciling "real" automatic CD
semantics with deliberate, session-scoped execution. Milestone: "Phase
12 — Local CD & Cluster Observability". Epic: GitHub issue #180.

- [x] Register a self-hosted GitHub Actions runner for this repo,
      on-demand mode (`./run.sh`, not installed as a persistent service)
      — verify it picks up a real queued job before anything depends on
      it (GitHub issue #88) — verified with a manual `workflow_dispatch`
      smoke test; also fixed an unrelated pre-existing local kubeconfig
      issue (`current-context` was unset) it happened to surface
- [x] `.github/workflows/cd.yml`: triggers on push to `main`, runs on
      the self-hosted runner, executes the build → `kind load` →
      `kubectl apply -k` → `rollout restart` sequence from
      `wiki/deployment-guide.md` section 4 (GitHub issue #89) — verified
      with a real merge (#95): the push queued the job automatically,
      starting the on-demand runner picked it up, and `GET /health`'s
      new `version` field matched the merge commit SHA exactly after
      the rollout, confirming the cluster ran the new code, not just
      that the workflow reported success
- [x] Wire `infra/k8s/overlays/dev-localstack` into `cd.yml` as the
      default deploy target, so local secrets/IAM (Phase 11) actually
      back every redeploy instead of staying an occasional manual
      opt-in (GitHub issue #99) — not part of the original phase-12
      planning batch, filed mid-phase after the user asked for exactly
      this (`docs/DECISIONS.md` D23, reversing D22's "CD stays on plain
      `dev`" default) — verified with a real merge: the queued job
      provisioned `localstack-credentials` from a new
      `LOCALSTACK_AUTH_TOKEN` repo secret, seeded LocalStack fresh, and a
      test candidate's stored `email_hash` matched the LocalStack-seeded
      secret's value, not the plaintext k8s Secret's
- [x] k9s + metrics-server for local cluster monitoring/management —
      `metrics-server` deployed into `kind` (needs the well-known
      `--kubelet-insecure-tls` patch for kind's self-signed kubelet
      certs), `kubectl top` and `k9s` both confirmed working against the
      real cluster (GitHub issue #90)
- [x] Engineering blog (last, once the above four are merged) (GitHub
      issue #91)

## Phase 13 — Local Infra Hardening & Reproducibility

Filed after the user asked, having just finished Phase 12, what other
infra-side possibilities existed before resuming app-feature work —
distinct from Phase 8, which is real production hardening gated on
triggers that haven't fired (a real AWS account, real traffic, more than
one contributor). This phase is scoped to making the *existing* local
setup provably solid, not building anything new toward production:
CI currently never validates `infra/k8s/**` or either Dockerfile (a
broken manifest merges green and only fails later, against the real
cluster); the `kind` cluster has been running continuously since Phase 7
with nobody proving it still bootstraps cleanly from empty; and
rebuilding it today means manually replaying several sections of
`wiki/deployment-guide.md` by hand. Milestone: "Phase 13 — Local Infra
Hardening & Reproducibility". Epic: GitHub issue #181.

- [x] CI job validating `infra/k8s/**` (`kubectl kustomize` against all
      four overlays) and both Dockerfiles (`docker build`, no push/run)
      — catches infra regressions at PR time instead of at real-CD time
      (GitHub issue #106)
- [x] `infra/scripts/bootstrap-kind.sh` — one-shot, idempotent script
      covering `wiki/deployment-guide.md` section 3 end to end (cluster
      create, Helm installs, image build/load, overlay apply, LocalStack
      seed) (GitHub issue #107)
- [x] Adversarial verification: tear down the real `kind` cluster and
      rebuild it from scratch using the new bootstrap script, proving
      every pod reaches `Ready`, PVCs bind cleanly, the full golden path
      works, and `api` genuinely reads secrets from LocalStack — not
      just that the script exits 0 (GitHub issue #108)
- [x] Engineering blog (last, once the above three are merged) (GitHub
      issue #109)

## Phase 14 — Recruiter & Overall Reviews + Moderation Admin UI

Filed after resuming app-feature work post-Phase-13, following a brainstorm
with the user on where to point development next. `RecruiterInteraction`/
`RecruiterRating`/`OverallReview` have had schema + migrations since Phase 1
but zero write path — `ModerationService` throws `NotImplementedException`
for either entity type, and `company_recruiter_aggregates`/
`company_overall_aggregates` (Phase 4 issue #7) have been permanently empty
since they were built, since nothing has ever written a row into either
underlying table. This is the single biggest remaining gap in the core
entity hierarchy (`docs/ARCHITECTURE.md`'s "Known gaps" section flagged it
first) — closing it finishes what Phases 1-4 started and makes two-thirds
of the Phase 4 analytics dashboard real instead of permanently "not enough
reviews yet." Bundled alongside it: a moderation admin UI, since even the
one entity type with a write path today (`round_rating`) is moderated only
via raw `curl` — adding two more entity types onto a curl-only moderation
queue would only compound that gap. Milestone: "Phase 14 — Recruiter &
Overall Reviews + Moderation Admin UI". Epic: GitHub issue #184.

- [x] `RecruiterInteraction` + `RecruiterRating` write path (GitHub issue
      #125) — same pattern as Phase 3 issue #1 (moderation-gated,
      `UNIQUE(recruiter_interaction_id, candidate_id)`); review search
      indexing stays out of scope. Recruiter identity resolution
      (find-or-create by a hashed candidate-supplied identifier, generating
      a sequential "Recruiter A"/"Recruiter B" label per company) needed a
      new `@@unique([companyId, internalIdentifierHash])` constraint on
      `recruiters`, not present since Phase 1
- [x] `OverallReview` write path (GitHub issue #126) — same pattern,
      `UNIQUE(process_id)` per `docs/DATA_MODEL.md` (enforced by the
      schema, surfaced as a 409 via `PrismaExceptionFilter` — no app
      logic needed). With this, every `ModerationEntityType` has a write
      path, so `ModerationService`'s `NotImplementedException` guard is
      gone entirely — the status flip is now an exhaustive switch over
      the enum. No new migration: the table and constraint have existed
      since Phase 1
- [x] Wizard: submit recruiter interaction + overall review (GitHub issue
      #127) — closes the same class of gap as the never-wired candidate
      email verification UI (Phase 3 issue #3). Two new wizard sections
      gated on a round existing; both confirmations show the real
      `pending` status (never a fake "published" message), and the
      recruiter-identifier field states it's never shown publicly
- [x] Moderation admin UI (GitHub issue #128) — replaces curl-only
      moderation across all three entity types; no new auth introduced,
      same trust model as the rest of `web/` today (auth is Phase 8's
      concern, not this one). `GET /moderation/queue` now enriches each
      entry with its entity's own fields + display context server-side —
      pending entities are deliberately unreadable via every public
      endpoint, so the UI had no other way to show what it's moderating.
      Only generated labels cross the wire, never
      `internal_identifier_hash` (and `candidateId` is omitted too)
- [x] Engineering blog (last, once the above four are merged) (GitHub
      issue #129) — `wiki/blog/
      phase-14-recruiter-overall-reviews-moderation-ui/`, one post per
      feature issue; Phase 14 is now fully done

## Phases 15-17 — planned together (user's call, 2026-07-19)

Deviation from the usual one-phase-at-a-time planning cadence, at the
user's explicit request after the post-Phase-14 brainstorm: all three
phases below were planned (milestones + issues) in one pass. They form
one deliberate arc — finish the public face of what Phase 14 made
writable (15), then the auth foundation (16), then everything auth
unblocks (17). Numbering still tracks planning order, as always.
Implementation stays strictly sequential: a later phase's issues don't
start until the earlier phase is done.

## Phase 15 — Public Company Profile Pages

A real public destination per company — today a company is only
reachable by searching for it, and the analytics dashboard reads like
an internal tool. Composes mostly-existing pieces (Phase 4 analytics
endpoint, Phase 5 search, unique slugs since Phase 1). Milestone:
"Phase 15 — Public Company Profile Pages". Epic: GitHub issue #185.

- [x] Company read paths: lookup by slug + approved reviews list
      (GitHub issue #140) — reviews read from Postgres, not OpenSearch
      (the index is derived/best-effort, D16/D17 — a profile page is a
      source-of-truth read, not a search). `GET /companies/by-slug/:slug`
      + `GET /companies/:id/reviews` (approved-only, paginated, shaped
      for display, candidateId never included)
- [x] Company profile page `/companies/[slug]` (GitHub issue #141) —
      header + shrinkage-scored aggregates (reusing `ScoreDisplay`,
      hard constraint #3) + paginated approved reviews list. The
      existing analytics dashboard moved from `/companies/[companyId]/
      analytics` to `/companies/[slug]/analytics` in the same issue —
      Next.js's App Router doesn't allow two differently-named dynamic
      segments at the same path level, so the two routes had to agree
      on `[slug]`. Both pages switched from the `params`-as-Promise +
      `use()` pattern to `useParams()` (synchronous, no Suspense
      boundary needed) along the way — simpler, and the only way to
      unit-test the page at all
- [x] Entry points: link search results, wizard, and analytics to
      profile pages (GitHub issue #142) — the wizard link landed as
      part of issue #141 (touched the same file for the analytics
      slug-rename); this issue added the remaining two: each search
      result row and the review-filtering header both link to
      `/companies/[slug]`, and the analytics page links back to its
      profile
- [x] Engineering blog (last) (GitHub issue #143) — `wiki/blog/
      phase-15-company-profile-pages/`, one post per feature issue;
      Phase 15 is now fully done

## Phase 16 — Candidate Accounts & Auth

Passwordless magic-link auth, chosen because it fits the email-hash
model unusually well: raw emails are used only transiently at request
time (never persisted, design principle 1), and a clicked login link
*proves email ownership* — subsuming D14's never-sent verification
email entirely. Unblocks Phase 2's deferred Update/Delete, my-reviews,
and the GDPR open decision (all Phase 17). Milestone: "Phase 16 —
Candidate Accounts & Auth". Epic: GitHub issue #182.

- [x] Local email delivery foundation — Mailpit, not LocalStack SES
      (decided + documented, D29) + api mail module (GitHub issue #144)
- [x] Magic-link authentication: request + consume + session issuance;
      first login flips `verificationStatus` (GitHub issue #145) —
      supersedes and removes Phase 3 issue #3's standalone verification
      endpoints, see D30
- [x] Sessions on the write path: candidateId from the session, not
      the request body (GitHub issue #146) — closes today's
      anyone-can-write-as-anyone gap. Four write paths, not three
      (`InterviewProcess` creation too, found by grepping the schema —
      see D31); `POST /candidates` removed entirely, not just gated;
      `web`'s wizard is broken until issue #147 picks it back up, by
      design
- [x] Login/logout UI + wizard integration (GitHub issue #147) — magic-
      link login page + verify-landing route, session state in the
      shared NavBar, wizard's step 2 gated on a real session instead of
      an inline email field. Found and fixed two real bugs live: a
      passive per-page-view `GET /auth/me` call 401s (and Chromium logs
      that as a console error) on every anonymous page view, fixed with
      a non-httpOnly session-hint cookie NavBar reads directly instead
      of polling the network; and `router.push` after verify left
      NavBar stuck showing "Log in" since it's mounted once in the root
      layout and doesn't remount on client-side navigation, fixed with
      a hard `window.location.href` redirect instead — see D32
- [x] Engineering blog (last) (GitHub issue #148) — one post per
      feature issue under `wiki/blog/phase-16-candidate-accounts-auth/`;
      Phase 16 is now fully done

## Phase 17 — Candidate Self-Service

What auth unblocks — including two debts as old as the project:
Phase 2's Update/Delete deferral and the GDPR retention/erasure open
decision. Milestone: "Phase 17 — Candidate Self-Service". Epic: GitHub
issue #183.

Kickoff brainstorm (before implementing, same pattern as Phase 16's)
resolved three gaps the already-filed issues #149-151 left open, all
folded back into their issue bodies before any code was written:
`GET /me/submissions` groups by `InterviewProcess` rather than three
flat lists (matches how a candidate actually thinks about "my
reviews"); Update/Delete is explicitly scoped to the three moderated
content types only (`RoundRating`/`RecruiterRating`/`OverallReview`) —
never the structural entities — and gets its own per-candidate edit
throttle (extending D13's pattern) to stop edit-churn on the
moderation queue; GDPR erasure clears the requester's session cookies
like logout and `CandidateJwtAuthGuard` starts verifying the
candidateId still exists in the DB, so a stale post-erasure token gets
a clean 401 instead of a downstream FK/not-found error, and shared
`Recruiter` rows are explicitly excluded from erasure (they're
per-company internal identity, referenced by potentially many
candidates).

- [x] My reviews: own submissions across all entity types, all
      statuses, owner-scoped, grouped by `InterviewProcess` (GitHub
      issue #149)
- [x] Update/Delete under moderation-safe rules: edits reset to
      `pending` and re-enqueue, never modify public content in place;
      rate-limited (GitHub issue #150) — see D33
- [x] GDPR erasure path: `DELETE /me` + retention policy decided and
      documented; clears session cookies; shared `Recruiter` rows
      excluded (GitHub issue #151) — see D34
- [x] Engineering blog (last) (GitHub issue #152) — Phase 17 declared
      fully done, then reopened while verifying Phase 24 issue #247:
      abandoned, content-free processes had no cleanup path on `/me`
      at all (GitHub issue #260, D46). Epic #183 reopened, same
      precedent Phase 18/20 already set.
- [x] Let a candidate delete an entirely-empty process (zero ratings/
      reviews in any status) — deliberately narrower than issue #150's
      own "never structural entities" scope, not a reversal of it;
      structurally superseded once Phase 26 ships, since an abandoned
      draft will never reach the database at all (GitHub issue #260,
      D46). Phase 17 is now fully done

## Phase 18 — Admin Authentication

Numbered after Phase 17 in planning order, but intended to be
**implemented before** Phases 16-17 — the same non-linear precedent
already set by Phase 6/8 sitting aside while Phases 9-15 proceeded around
them. Filed after a strategic infra/security review (2026-07-20) surfaced
that the moderation admin surface built in Phase 14
(`ModerationController`, `web/src/app/moderation/page.tsx`) has zero
authentication — both files say so directly in their own comments.
Anyone who can reach the URL can approve, reject, or flag any pending
rating/review. This stayed low-risk only because every environment has
been localhost/kind so far; it becomes a real hole the moment anything is
reachable by anyone else (a cloud staging box, or even a shared demo).
Deliberately minimal in scope — a single shared admin credential, not a
multi-user/RBAC system, matching this project's own "don't build for
hypothetical future requirements" convention; revisit if/when a second
admin ever exists. Milestone: "Phase 18 — Admin Authentication". Epic:
GitHub issue #167.

- [x] Backend: admin login endpoint, JWT session issuance (httpOnly
      cookie), guard applied to every `ModerationController` route, login
      endpoint rate-limited (PR #188, GitHub issue #159)
- [x] Frontend: login page + route gating for `/moderation` + logout
      (PR #189, GitHub issue #160)
- [x] Engineering blog (`wiki/blog/phase-18-admin-authentication/`,
      GitHub issue #161) — one post per feature issue (#159, #160)
- [x] Rotate admin credentials: real bcrypt hash + JWT signing secret,
      taken out of the git-tracked manifest entirely (PR #195, GitHub
      issue #192) — filed after a real login attempt surfaced both a
      Secure-cookie-over-plain-HTTP bug (fixed directly) and the fact
      every environment still shared the same dev-only credential
- [x] Moderation page: redirect to login on a mid-session 401, not just
      at initial load (GitHub issue #193)

## Phase 19 — Content Quality & Synthetic Data

Filed alongside Phase 18 from the same 2026-07-20 strategic review. Three
independent issues (any order) closing gaps already documented elsewhere:
D13's exact-match/full-table-scan duplicate detection limit, the total
absence of any content-quality signal beyond mechanical fraud checks, and
`docs/ARCHITECTURE.md`'s cold-start gap (no synthetic data generator
exists for lower environments). Milestone: "Phase 19 — Content Quality &
Synthetic Data". Epic: GitHub issue #168.

**Kickoff brainstorm (2026-07-27)**, run before implementation given how
much shipped in the seven months since filing — Phase 24's rating-field
redesign, Phase 25/26's bulk-submission endpoint, Phase 29's fraud-check
reframing (already extended near-duplicate scanning to all three entity
types), and Phase 35's company-moderation gate all touch these three
issues' original assumptions. All three issue bodies updated on GitHub
to record the resolved decisions before implementation began; see each
bullet below and the issues themselves for the full reasoning.

- [x] Near-duplicate review detection: `pg_trgm` trigram similarity
      (not embeddings — stays inside Postgres, no new external
      dependency), `similarity() > 0.55` as a starting placeholder
      threshold, applied to all three entity types Phase 29 issue #317
      already scoped `checkDuplicateFreeText()` to — computed via a
      `$queryRaw` similarity query backed by a new partial GIN trigram
      index on each of the three free-text columns, replacing D13's
      exact-match/full-table-scan implementation entirely (GitHub
      issue #162, D64)
- [x] LLM-assisted moderation triage: Anthropic's Claude API via
      `@anthropic-ai/sdk`, model configurable via `ANTHROPIC_MODEL`
      (not hardcoded), `ANTHROPIC_API_KEY` provisioned imperatively
      like `admin-credentials`/`localstack-credentials` (never
      committed, and genuinely optional — disabled by default rather
      than a boot-time requirement), verdict stored as one nullable
      JSONB column (mirroring `Round.typeMetadata`'s precedent) —
      advisory only, never auto-approves/rejects, hard constraint #2
      stays intact (GitHub issue #163, D66) — built in-process/
      synchronous here deliberately; Phase 32 (filed later, D53)
      depends on this issue shipping first, then ports the same logic
      into an async `review-analyzer` service once Phase 30's event
      bus exists
- [x] Synthetic data generator for lower environments
      (`api/scripts/seed-demo-data.ts`): `@faker-js/faker` (pinned to
      8.4.1 — the current major ships pure ESM with no CJS build,
      breaking Jest; see D62) plus an in-process NestJS application
      context calling real services directly
      (`CompaniesService`+`ModerationService.approve()` for the Phase
      35 moderation gate, `BulkProcessSubmissionService` for the Phase
      25/26 real submission path, `RoundTypeFieldOptionsService` for
      registry-valid `type_metadata`) — not raw HTTP or raw SQL/Prisma,
      avoiding the Phase 5 seed-script indexing bug this issue already
      warned against. Varies both review-count distribution (exercising
      the shrinkage floor on purpose) and moderation-outcome
      distribution. Safety-guarded by `assertSeedTargetConfirmed()`, the
      same class of check as `assertLocalE2eIsolation()` (GitHub issue
      #383/D61, this same week) but allowing an explicit override, since
      seeding a real dev/demo/staging database on purpose is the whole
      point (GitHub issue #164, D62)
- [x] Engineering blog (last) (GitHub issue #165)

## Phase 20 — Operational Hardening & Live-Verification Findings

Filed retroactively, 2026-07-24, per a new standing convention: every
ad-hoc dev/test/structural task — not just planned `docs/ROADMAP.md`
feature work — gets tracked under an Epic, even when the work itself
already happened before the issue existed. Four cross-cutting items
surfaced this way, none discovered through planned feature work: a CD
disk-pressure incident found while verifying the Phase 17 golden-path
smoke test, the smoke test itself (built to make live verification
repeatable and safe), a real Prisma race the smoke test's own
stress-testing surfaced, and two product-review findings (login-page
copy, an open anonymous-write gap on company creation). Milestone:
"Phase 20 — Operational Hardening & Live-Verification Findings". Epic:
GitHub issue #214.

- [x] Prune stale Docker artifacts after every CD deploy — five days of
      CD runs had filled the shared Docker Desktop disk to 96%,
      tripping OpenSearch's flood-stage watermark and crash-looping
      `api` on an unrelated merge (no real outage). `cd.yml` gained a
      cleanup step; a near-miss with node-internal `crictl rmi --prune`
      documented as the reason host-level Docker cleanup is used
      instead (PR #210, GitHub issue #215, D35)
- [x] Full golden-path smoke test, opt-in and DB-safety-guarded — one
      continuous test walking the entire feature set built so far,
      safe to rerun on demand against the isolated test database
      (`assertUsingTestDatabase()` refuses anything else), deliberately
      excluded from CI (PR #211, GitHub issue #216, D36)
- [x] `GET /moderation/queue` isolates each entity type's enrichment —
      the smoke test's own stress-testing surfaced a transient Prisma
      required-relation race (a concurrent GDPR erasure/Update-Delete
      committing mid-query), confirmed via the live schema that no
      durable orphaned row is possible; the real bug was `Promise.all`
      letting one entity type's failure crash the whole endpoint for
      every caller (PR #213, GitHub issue #212, D37)
- [x] Honest login-page copy + lock down `POST /companies` — the login
      form already always upserts a candidate but its copy read as
      login-only; `POST /companies` had neither a session requirement
      nor rate limiting, an anonymous-write gap predating Phase 16
      entirely since `Company` has no `candidateId` (PR #219, GitHub
      issue #217, D38)
- [x] Engineering blog (last) (GitHub issue #218) — Phase 20 declared
      fully done, then reopened the same day: a user-reported bug ("nav
      bar shows log in even after login") traced to session cookies
      being host-only, invisible to `web`'s JS on any deployed
      environment where `web`/`api` don't share a hostname (issue #222,
      D39). Epic #214 and milestone #17 reopened, same precedent
      Phase 18 already set.
- [x] Session cookies gain an explicit shared `Domain` (`COOKIE_DOMAIN`)
      so `web`'s NavBar/wizard session checks actually see a real login
      on any deployed environment — verified via `Set-Cookie` through
      the real Ingress and a live headless-browser run confirming
      "Log out" renders correctly (GitHub issue #222, D39)
- [x] Engineering blog update for issue #222 (D39) — Phase 20 declared
      fully done, then reopened a second time the same night: a CD
      deploy failed with the exact D35 crash signature (OpenSearch's
      flood-stage watermark) but from a disk D35's fix never covered —
      the kind node's own internal containerd store, filled by
      repeated `kind load docker-image` calls across a single heavy day
      (GitHub issue #240, D43). Epic #214 and milestone #17 reopened
      again, same precedent already set twice this phase.
- [x] `infra/scripts/prune-kind-node-images.sh` safely prunes the kind
      node's own orphaned images — cross-references every pod's actual
      running image digest cluster-wide before removing anything
      (never a blind `crictl rmi --prune`, per D35's own near-miss),
      wired into `cd.yml` as a second prune step; verified live against
      the real incident, freeing the node's disk from 91% to 45% and
      unblocking the stuck deploy (GitHub issue #240, D43)
- [x] Engineering blog update for issue #240 (D43) — Phase 20 is now
      fully done
- [x] `api/scripts/prune-orphaned-company-search-docs.js` diffs the
      `companies` OpenSearch index against Postgres and bulk-deletes
      anything with no matching row — a live sweep found 415 such
      orphans (420 documents against 5 real rows), all accumulated from
      test-cleanup sessions that only ever deleted the Postgres row
      (D44's existing pattern) and never re-synced the index; deleted
      the 415 confirmed orphans directly and added the script so this
      doesn't require trusting a purely manual checklist step going
      forward (GitHub issue #278, D51). Epic #214 reopened and
      re-closed the same day, same precedent as #222/#240.
- [x] Engineering blog update for issue #278 (D51) — Phase 20 is now
      fully done
- [x] `infra/scripts/dev-port-forwards.sh` wires the local Postgres/
      OpenSearch/Mailpit port-forwards into macOS launchd LaunchAgents
      instead of plain backgrounded `kubectl port-forward` jobs, which
      only survive as long as the shell that started them — unreliable
      across separate AI-assisted tool-call shells, confirmed dying
      repeatedly during Phase 28's live verification. `KeepAlive`
      auto-restarts a forward if it ever exits; verified persistence
      directly by `exec`-ing into a fresh shell and confirming the
      forwards were still listening (GitHub issue #312). Epic #214
      reopened and re-closed the same day, same precedent as #222/
      #240/#278.
- [x] Engineering blog update for issue #312 — Phase 20 is now fully
      done
- [x] Public company Reviews section groups approved round ratings by
      their submission (`InterviewProcess`), not raw row count — a
      user report found a 3-round submission plus 1 separate one
      showing as "4 reviews" instead of the real 2; the same flat-list
      problem Phase 29 issue #315 already fixed for the moderation
      queue. Pagination moves with the grouping (submissions, not raw
      rows, so one submission's rounds are never split across a page
      boundary) (GitHub issue #347, D54). Epic #214 reopened and
      re-closed the same day, same precedent as #222/#240/#278/#312.
- [x] Engineering blog update for issue #347 (D54) — Phase 20 is now
      fully done
- [x] `/me`'s process card labels its own outcome distinctly from
      moderation status — a bare "Rejected" (the process's own
      self-reported outcome) read as a sixth moderation verdict
      alongside five real ones, especially confusing when it was the
      opposite of what every actual status said. Now `Outcome:
      Rejected`, copy-only (GitHub issue #349, D55). Epic #214
      reopened and re-closed the same day, same precedent as
      #222/#240/#278/#312/#347.
- [x] Engineering blog update for issue #349 (D55) — Phase 20 is now
      fully done
- [x] `/me`'s process cards collapse by default and expand on click —
      direct user request to match the moderation queue's own
      collapsed-by-default / expand-on-click pattern (GitHub issue
      #385). Epic #214 reopened and re-closed the same day, same
      precedent as #222/#240/#278/#312/#347/#349.
- [x] Fix: "View details" and "View company profile" (issue #385's own
      layout) rendered on visibly separate lines on narrower viewports
      — `flex-1`'s zero flex-basis never triggered a wrap, so a long
      title just shrank the toggle button instead of wrapping,
      stranding "View details" far from the profile link. Grouped both
      labels into one flex sub-container that can't split apart, with
      the title stacking full-width above them below the `sm`
      breakpoint (GitHub issue #387). Epic #214 reopened and re-closed
      the same day, same precedent as #222/#240/#278/#312/#347/#349.
- [x] "View details" is now the actual clickable toggle (a hyperlink-
      styled button), not the whole title row — direct user follow-up
      request; the title block is now plain static text (GitHub issue
      #389). Epic #214 reopened and re-closed the same day, same
      precedent as #222/#240/#278/#312/#347/#349/#387.
- [x] Fix: `api/scripts/*.ts` files were being pulled into `nest
      build` (`tsconfig.build.json` had no exclusion for `scripts`),
      shifting every compiled `dist/` output path and crash-looping the
      deployed pod on the very next CD run — `tsconfig.build.json` now
      excludes `scripts` explicitly (GitHub issue #393, D63). Epic #214
      reopened and re-closed the same day, same precedent as
      #222/#240/#278/#312/#347/#349/#387/#389.

## Phase 21 — Anonymous Visitor Soft-Gating

Filed 2026-07-24 after a UI/UX brainstorm surfaced a deliberate product
pivot: soft-gate (teaser + CTA, never a hard redirect) the company profile
page and analytics dashboard for anonymous visitors, to drive candidate
signups. This reverses part of Phase 15's "fully public" design intent —
asked directly, the motivation is signup pressure, not a scraping/abuse
concern, and the mechanism is a soft gate matching how Glassdoor itself
gates deeper content. Milestone: "Phase 21 — Anonymous Visitor
Soft-Gating". Epic: GitHub issue #225.

- [x] Soft-gate company profile & analytics pages — a new reusable
      `GatedSection` component (mirroring `EmptyState`'s minimal style),
      driven by the existing `hasCandidateSessionHint()` cookie-hint
      idiom (D32), no new backend auth. Profile page keeps the header and
      "Overall experience" section as a free hook, gating the round-type
      breakdown and all reviews beyond the first; the analytics page
      (already framed as "the full breakdown") gates its three data
      sections behind one combined prompt. The homepage wizard's company
      picker and "Change company" button stay ungated — pure navigation
      with no data to tease (GitHub issue #226, D40)
- [x] Engineering blog (last) (GitHub issue #227) — Phase 21 is now
      fully done

## Phase 22 — Visual Design Refresh

Filed 2026-07-24 from the same UI/UX brainstorm as Phase 21, after the
user characterized the app as "looks simple but not cool." Scoped to
three mechanical, low-risk directions — typography, depth/surface, and
layout width — not a redesign; color-palette expansion and a real
brand mark were raised as a second-pass option, not attempted here.
Milestone: "Phase 22 — Visual Design Refresh". Epic: GitHub issue #230.

- [x] Typography, depth/surface, and layout-width pass — `Inter` via
      `next/font/google` (self-hosted at build time); an explicit page
      background (previously missing entirely, light or dark) so a
      card's shadow has something to contrast against; a new `Card`
      component replacing 11 duplicated flat-border strings; controls
      bumped to `rounded-md`, cards to `rounded-xl`, with
      `transition-colors` added to every hover state (a clean addition —
      no `transition-*` existed anywhere before this); `PageContainer`
      gained a `size` prop (narrow for forms, wide for the four
      data-heavy pages), with `NavBar`'s own width synced to match
      (GitHub issue #231, D41)
- [x] Engineering blog (last) (GitHub issue #232) — Phase 22 is now
      fully done

## Phase 23 — Color System & Brand Mark

Filed 2026-07-24, the two directions deliberately scoped out of Phase
22 as design-taste calls: a formalized `Button` color-variant system
and a real brand mark. Milestone: "Phase 23 — Color System & Brand
Mark". Epic: GitHub issue #235.

- [x] Button color variants, focus rings, and a brand mark — `Button`
      gained a `variant` prop (`primary`/`danger`/`neutral`/`warning`),
      formalizing colors already in use rather than introducing a new
      accent hue, replacing 10 duplicated inline color overrides across
      `me/page.tsx`/`moderation/page.tsx`; visible focus-ring styling
      added to `Button` and every text input; a new `BrandMark`
      component (an inline SVG star badge, no external asset) placed in
      `NavBar` and reused as the site favicon via `app/icon.svg`
      (GitHub issue #236, D42)
- [x] Engineering blog (last) (GitHub issue #237) — Phase 23 is now
      fully done

## Phase 24 — Round-Type Registry & Rating Field Redesign

Planned together with Phases 25-26 in one pass, 2026-07-25, from a
UI/UX brainstorm about round-level rating detail and a full wizard
rewrite — tightly sequential (24 → 25 → 26), same "plan several phases
together, implement strictly in order" precedent the "Phases 15-17
planning" pass already set. Numbered after Phase 19 in filing order but
planned/implemented ahead of it — the same non-linear precedent Phase
6/8/18/20/21/22/23 already set.

Redesigns what a round rating and a recruiter rating actually collect
(interviewer traits reduced to fluency/clarity/focus, recruiter fields
expanded to reachability/responsiveness/guidelines-shared/rejection-
message-authenticity — the recruiter mapping has real open questions
and gets its own kickoff brainstorm before implementation, same as
Phase 16/17/21 each did) and introduces a shared round-type registry
(round type → `type_metadata` schema → form component → validation) so
type-specific detail — starting with coding (`problemAlgorithms`,
`problemDataStructures`) and system design (`keyConcepts`,
`highLevelConcept`), both via the existing `type_metadata` JSONB column
(`docs/DATA_MODEL.md` principle #4, no new columns) — is a registry
entry, not scattered conditional logic. Milestone "Phase 24 —
Round-Type Registry & Rating Field Redesign". Epic: GitHub issue #244.

- [x] Redesign `round_ratings` interviewer-trait fields — drop
      `fairness`/`bias_signal`, rename `communication_fluency`→
      `fluency`/`attentiveness`→`focus`, add `clarity`; touches the
      `company_round_type_aggregates` materialized view, DTOs/services,
      every frontend surface showing these fields, and every existing
      test referencing the old names (GitHub issue #247, D45)
- [x] Round-type registry + `type_metadata` schemas for all 8 round
      types (expanded from the original coding/system_design-only scope
      at the project owner's direction before implementation — see
      GitHub issue #248, D47). Controlled-vocabulary values are
      admin-managed via a new `round_type_field_options` table; this
      issue builds the read side (registry, service-layer validation,
      public `GET /round-types/field-options`) and seeds illustrative
      defaults — admin CRUD over the table itself is the new Phase 27.
- [x] Redesign `recruiter_ratings` fields — kickoff brainstorm resolved
      the mapping (`response_time`+`timeliness` merged into
      `responsiveness`, `communication_quality` dropped,
      `approachability` renamed+reinterpreted as `reachability`,
      `guidelines_shared`/`rejection_message_authenticity` new — the
      latter nullable and self-reported, no backend outcome gating)
      before implementation (GitHub issue #249, D48)
- [x] Engineering blog (last) (GitHub issue #250)

## Phase 25 — Bulk Process Submission API

Adds a single transactional endpoint accepting a whole interview-
process tree in one payload — the backend counterpart Phase 26's draft
wizard needs before it can submit anything for real. Existing
per-entity endpoints stay unchanged; this is a new path, not a
replacement. Milestone "Phase 25 — Bulk Process Submission API". Epic:
GitHub issue #245. Depends on Phase 24's field shapes being finalized.

- [x] Bulk process-submission endpoint, single `$transaction`,
      moderation-queue entries created per rateable entity exactly as
      today's incremental writes, just batched (GitHub issue #251, D49)
- [x] Engineering blog (last) (GitHub issue #252)

## Phase 26 — Client-Side Draft Wizard (Flashcard Navigation)

Rewrites the wizard around client-side draft state (localStorage, no
DB writes until final submit — rate limits still apply, evaluated at
submit time), a flashcard-style step UI navigable freely and in any
order (recruiter-screening, technical-screening, per-round-type cards,
etc. — explicitly reversible, not a one-way swipe-and-commit pattern),
and a final review screen that sorts everything chronologically before
the one real submit call. Recruiter touchpoints (start/end of a
process — the schema already supports many `RecruiterInteraction`s per
process, only the wizard UI ever created one) become just another step
kind in the same registry. Milestone "Phase 26 — Client-Side Draft
Wizard (Flashcard Navigation)". Epic: GitHub issue #246. Depends on
Phase 25's bulk endpoint.

- [x] Client-side draft state architecture, supporting multiple
      simultaneous in-progress company drafts (GitHub issue #253, D50)
- [x] Flashcard-style step navigation, consuming Phase 24's registry
      (GitHub issue #254)
- [x] Chronological review screen + bulk-submit integration (GitHub
      issue #255)
- [x] Engineering blog (last) (GitHub issue #256)

## Phase 27 — Admin Content Gateway (Round-Type Field Options)

Filed alongside Phase 24 issue #248, at the project owner's direction:
the round-type registry's controlled-vocabulary `type_metadata` values
(which algorithms, which leadership principles, etc.) must be
admin-manageable through a UI, not hardcoded. Issue #248 built only the
read side — the registry, service-layer validation, and a public
`GET /round-types/field-options` — plus seeded illustrative defaults
into a new `round_type_field_options` table (`docs/DECISIONS.md` D47).
This phase builds the write side: an admin CRUD API and UI to add,
retire, and reorder those values. Numbered after Phase 26 in filing
order and implemented after it too — unlike several earlier non-linear
phases, nothing in Phase 25/26 depends on this admin UI existing, since
Phase 24 already seeds working defaults. Milestone "Phase 27 — Admin
Content Gateway (Round-Type Field Options)". Epic: GitHub issue #262.

- [x] Admin CRUD API for `round_type_field_options`, gated by
      `AdminJwtAuthGuard` same as `ModerationController` (GitHub issue #263)
- [x] Admin UI page to manage round-type field options, mirroring
      `moderation/page.tsx`'s session-check shape (GitHub issue #264)
- [x] Engineering blog (last) (GitHub issue #265)

## Phase 28 — Wizard UX Refinements

Filed 2026-07-25 from a batch of live-verification findings against the
Phase 26 client-side draft wizard: an unfriendly raw validation-error
message on submit, round ratings requiring an opt-in click on every
round, no way to advance through steps without returning to the
navigator each time, a missing "Tech Screening" round type, recruiter
step wording/timing-editability issues, no explanation of what each
recruiter trait measures, and a round's title being both mandatory and
displayed as the literal word "untitled" when absent. Milestone
"Phase 28 — Wizard UX Refinements". Epic: GitHub issue #280.

- [x] Client-side pre-submit validation + friendly fallback messages
      for any backend validation error that still reaches the UI
      (GitHub issue #281)
- [x] New rounds default to having a rating already available
      (checked), not opt-in per round (GitHub issue #282)
- [x] "Next" button on every step, advancing through a fixed
      process -> rounds -> recruiter steps -> overall review -> review
      order, alongside the existing free-jump navigator (GitHub issue
      #283)
- [x] "Tech Screening" added as a `RoundType`, with its own registry
      fields and seeded default values (GitHub issue #284)
- [x] Recruiter step wording renamed to pre-interview/post-interview
      throughout, and its timing field made read-only (already chosen
      at add-time, not editable in place) (GitHub issue #285)
- [x] Tooltips explaining each recruiter trait rating (GitHub issue
      #286)
- [x] Round title made optional; every display site reformatted to
      "{Type} - {Title}" (title segment omitted entirely when absent)
      (GitHub issue #287)
- [x] Engineering blog (last) (GitHub issue #288)

Reopened once more, same day: explaining why the wizard's write path
isn't session-gated (Phase 26's deliberate design — a draft is pure
client-side state until the one atomic submit) surfaced a related gap
— the candidate session expires a fixed 1h after login with no live
re-check, so a candidate on a long draft could see Submit as available
long after their session actually died.

- [x] Warn candidates when their session expires mid-draft — a live
      30s poll (not just a mount-time check) detects the transition
      and shows an inline warning across every step of the active
      draft, with the review screen's existing session gate
      correcting itself automatically; a submit that still hits a 401
      shows the same clear message instead of the generic
      validation-error fallback (GitHub issue #301)

Reopened a third time, same day: three more follow-ons from live
discussion of the wizard — round rating traits had no tooltip at all
(recruiter traits only got one, issue #286), the "Next" button
(issue #283) could silently skip past adding a round entirely, and
draft validation needed to be genuinely modular plus two new rules
(require at least one round; remind, don't force, on missing
pre/post-interview recruiter touchpoints).

- [x] Question-mark "?" tooltip button, on hover and keyboard focus,
      for every round AND recruiter trait rating — redesigned from
      issue #286's dotted-underline/title-attribute pattern for
      consistency (GitHub issue #305)
- [x] Modularized `validateDraft()` into independent rule functions;
      new hard rule requiring at least one round before submission;
      new non-blocking reminder rules for missing pre/post-interview
      recruiter touchpoints, with a review-screen confirmation panel
      ("+ Add now" / "Submit anyway") (GitHub issue #307)
- [x] "Next" opens an add-round modal instead of navigating directly
      whenever it would leave round-adding territory for the first
      time (from Process Details with no round yet, or the last
      existing round) — offering Add round / Finish draft & go to
      review / No, continue; Next is blocked entirely on the current
      step's own validation issues, same as Submit, except the
      whole-draft "at least one round" rule (GitHub issue #306)
- [x] Engineering blog update for issues #305-307

Reopened a fourth time, same day: the sidebar's original "Add a round"
control (from before #306's modal existed) was left in place alongside
the new modal, two redundant ways to do the same thing.

- [x] Consolidated round-adding into the Next-button modal only —
      removed the sidebar's "Add a round" section (its two recruiter
      add buttons are unaffected); reordered the round-type select to
      match a typical interview loop (Tech Screening/Assessment/
      Take-home first, Other last) and defaulted it to an unselected
      "None" with "Add new round" disabled until a real type is
      chosen; renamed "Add round" -> "Add new round" and "No,
      continue" -> "Cancel" — the latter also changed behavior to just
      close the modal without navigating, since the sidebar shortcut
      it used to fall back to no longer exists (GitHub issue #319)
- [x] Engineering blog update for issue #319

## Phase 29 — Moderator Full Content Visibility & Submission Consistency

Filed 2026-07-25 after the user asked that moderators be able to see
every data point a candidate submitted (not just highlights), that
draft/moderation-queue/candidate-submission field shapes stay
consistent, and that the existing fraud-check rate limit be verified.
A read-only investigation confirmed all three concerns are real: a
round rating's `description`, `typeMetadata` (the round-type
registry's structured answers — arguably the most important content
to actually moderate), `scheduledDurationMinutes`, and any interviewer
display label are fetched by `ModerationService.listPending()` but
silently dropped, never reaching the moderator; `web/src/lib/api.ts`'s
`ModerationQueueEntity.roundTitle` is typed `string` instead of the
correct `string | null` used by the other two read surfaces; and
`FraudChecksService`'s 3-ratings/rolling-24h limit counts round
ratings only — recruiter ratings and overall reviews (both
single-create and bulk-submission paths) have no fraud-check wiring
at all. Milestone "Phase 29 — Moderator Full Content Visibility &
Submission Consistency". Epic: GitHub issue #314.

- [x] Moderation queue: surface a round's `description`, `typeMetadata`,
      and `scheduledDurationMinutes` (all fetched already but
      previously dropped before reaching the moderator), and — per
      direct user feedback mid-implementation — group every pending
      entity by its `InterviewProcess` ("submission") instead of
      returning a flat list, so a moderator sees one collapsed row per
      submission with an expand action revealing full per-entity
      detail. Interviewer display label judged out of scope: `Round.
      interviewerId` has no write path anywhere in the codebase today,
      so there is no data to enrich with (GitHub issue #315)
- [x] Fix `ModerationQueueEntity.roundTitle`'s type (`string` ->
      `string | null`), matching `CompanyReviewItem`/
      `MySubmissionRoundRating` — resolved as a side effect of #315's
      own rewrite of the same type, closed without a dedicated PR
      (GitHub issue #316)
- [x] Rework fraud-check rate limiting to count submissions
      (`InterviewProcess` creations), not individual entities, and
      extend it to recruiter ratings and overall reviews alongside
      round ratings, in both the single-create and bulk-submission
      paths — reframed per D52 after live data showed the entity-count
      version could trip on a single legitimate multi-round submission
      (GitHub issue #317)
- [x] Engineering blog (last) (GitHub issue #318)

## Phase 30 — Event-Driven Foundation

Filed 2026-07-25 from a brainstorm about moving toward event-driven
microservices — deliberately revisits `docs/DECISIONS.md` D12
("moderation stays in-process, no event bus"), not because organic
load now demands it, but because the project owner wants real
distributed-systems/microservices practice, the same category of
trigger Phase 10/11 already accepted for LocalStack IAM/secrets work.
Recorded as D53, alongside the reasoning for why moderator-service
(also discussed) is deliberately not phased. Milestone: "Phase 30 —
Event-Driven Foundation". Epic: GitHub issue #327.

This phase is deliberately narrow: the message broker (Redpanda) and a
best-effort, after-commit event-publishing pattern — matching D16/D17's
already-proven "never block the write" shape for OpenSearch indexing.
No new deployable service ships in this phase; it's the plumbing
Phases 31-32 build on. The synchronous write path itself (including
`ModerationService.enqueue()`) is unchanged.

- [ ] Add Redpanda to local infra (docker-compose + k8s), mirroring
      how OpenSearch was added in Phase 5 (GitHub issue #330)
- [ ] Shared event-publishing module (`api/src/events/`) + a versioned
      event-schema contract, best-effort/after-commit per D16/D17
      (GitHub issue #331)
- [ ] Wire creation + moderation status-change events for all three
      moderated entity types, in both the single-create and
      bulk-submission paths (GitHub issue #332)
- [ ] Engineering blog (last) (GitHub issue #333)

## Phase 31 — Notification Service

Filed alongside Phase 30 from the same brainstorm. Depends on Phase
30's event bus existing first. Deliberately the lowest-risk of the two
service extractions discussed (notification-service / review-analyzer)
— `mail/` is already a clean-boundary module with no write-path
dependencies, making this the right first proof that the whole pattern
(broker, a real out-of-cluster consumer, independent deployment,
idempotent consumption) works end to end on the `kind` cluster.
Milestone: "Phase 31 — Notification Service". Epic: GitHub issue #328.

Shipping this phase fires `docs/ROADMAP.md` Phase 8's own sub-area 8g
trigger ("Distributed systems hardening... the first real Kafka/
Redpanda consumer existing at all") for the first time — that gets its
own planning pass under Phase 8's existing menu structure once this
phase actually ships, per Phase 8's own "plan one sub-area at a time,
only once its trigger fires" convention; not pre-filed here. Phase 8f
(observability/tracing) is **not** triggered by this — its own stated
trigger (first shared/staging deployment with real traffic) still
hasn't fired.

- [ ] `notification-service` skeleton + its own Dockerfile/k8s
      manifest/CD step (GitHub issue #334)
- [ ] Consume `*.created` events → "your submission is pending review"
      email, idempotent (GitHub issue #335)
- [ ] Consume `*.status_changed` events → approved/rejected
      notification, idempotent (GitHub issue #336)
- [ ] Engineering blog (last) (GitHub issue #337)

## Phase 32 — Review Analyzer Service

Filed alongside Phases 30-31 from the same brainstorm. Depends on
Phase 19 issue #163 (LLM-assisted moderation triage) already being
implemented in-process, and on Phase 30's event bus existing —
deliberately sequenced so the analysis logic and the service-extraction
plumbing aren't both being invented at once, the same "prove it simply
first, extract once a trigger fires" pattern this project already used
for OpenSearch (Phase 5). Phase 19 itself is unchanged in scope; this
phase is about *where* issue #163's logic runs, not re-deciding *what*
it does. Milestone: "Phase 32 — Review Analyzer Service". Epic: GitHub
issue #329.

Real open questions (review-analyzer vs. `FraudChecksService`'s
existing synchronous checks, LLM/API choice, data ownership) are
flagged for a kickoff brainstorm (issue #338) rather than resolved
here, same pattern Phase 16/17/21/24/29 each used.

- [ ] Kickoff brainstorm: review-analyzer's relationship to
      `FraudChecksService`, LLM choice, data ownership (GitHub issue
      #338)
- [ ] `review-analyzer` service skeleton, consumes `*.created` events
      (GitHub issue #339)
- [ ] Port Phase 19 issue #163's LLM-assisted triage into
      review-analyzer as an async, arrives-later enrichment — never
      auto-approves/rejects, hard constraint #2 stays intact (GitHub
      issue #340)
- [ ] Engineering blog (last) (GitHub issue #341)

## Phase 33 — Search-First Landing Page

Filed retroactively, 2026-07-26, per the user's direct request: the
landing page should be for searching/browsing reviews, not writing
one — a deliberate product pivot, the same category of direct-request
pivot Phase 21 (anonymous visitor soft-gating) already used as
precedent for getting its own phase rather than folding into Phase
20's operational-hardening epic. Milestone: "Phase 33 — Search-First
Landing Page". Epic: GitHub issue #351.

- [x] Swap `/` and `/search`'s body content (search/browse becomes the
      landing experience, the write-a-review wizard moves to
      `/search`); add a quick-select company-button grid to the new
      landing page; remove the wizard's own company-picker entirely,
      replaced by a "Write a review" link on search results and a
      company's profile page that carries the chosen company into the
      wizard via query params; NavBar's link relabeled "Write a
      review" (GitHub issue #352, D56)
- [x] Engineering blog (last) (GitHub issue #353)

## Phase 34 — Write-a-Review Flow Refinements

Filed 2026-07-25, from a batch of five direct UI/UX requests following
Phase 33's search-first swap: homogeneous company-list rows (a plain
"Browse reviews" button instead of a clickable company name, "Write a
review" alongside "View profile", applied identically to both the
typed-search-results list and the quick-select button grid); dropping
the parenthesized "(view profile)" styling so it matches the plain
"View profile" link elsewhere; removing NavBar's standalone "Write a
review" link entirely, since writing a review is now always
company-specific; and a search-failure-triggered "request a new
company" flow, deliberately unreachable from anywhere except a
zero-results search. Resolving these also surfaced two more open
questions (both resolved directly with the project owner before
filing): the wizard's own drafts list and create-company form, both
displaced by the above, needed a new home — a dedicated, login-gated
`/drafts` route was chosen over folding them elsewhere — and the
wizard itself needed a distinct route name rather than continuing to
live at `/search` now that `/search` is gone (folded into `/`, no
duplicate route). Milestone: "Phase 34 — Write-a-Review Flow
Refinements". Epic: GitHub issue #356.

- [x] New `/write-review` route replaces the wizard's use of
      `/search`; supports both `?companyId=&companySlug=&companyName=`
      (start-or-resume by company) and `?draftId=` (resume an exact
      draft, used by `/drafts`'s Resume links); redirects home if
      visited with neither; the create-company form and inline drafts
      list are dropped from its no-context state entirely (they move
      to issues #359/#360); NavBar's "Write a review" link removed
      (GitHub issue #358)
- [x] New `/drafts` page — login-gated (`GatedSection`, presentation-layer
      only: drafts are still plain localStorage, not a real session)
      list of every in-progress draft with Resume/Delete actions;
      NavBar gains a "My drafts" link, shown only when logged in
      (GitHub issue #359)
- [x] Homogeneous company-list rows: a `CompanyResultRow`-shaped
      "Browse reviews" + "View profile" + "Write a review" action set
      for the typed-search-results list; step 2's "(view profile)"
      restyled to match plain "View profile" (GitHub issue #357 —
      originally also applied to the quick-select button grid, reverted
      there by GitHub issue #366, see below)
- [x] Search-failure "request a new company" flow: a button on the
      zero-results empty state opening an inline create-company
      section (rewritten copy for the request framing, not "write a
      review"), redirecting to `/write-review?companyId=...` on
      success; never reachable any other way (GitHub issue #360)
- [x] Engineering blog (last) (GitHub issue #361)
- [x] Revert the quick-select ("Or pick one directly") company grid
      back to plain, name-only buttons — direct user feedback that
      issue #357's homogeneous-row shape there created redundancy on an
      already-long company list; the typed-search-results list keeps
      the full `CompanyResultRow` shape unchanged (GitHub issue #366)
- [x] Fix: the quick-select grid still rendered every approved company
      unbounded (`listCompanies()`, no cap) — the scaling problem #366
      flagged but didn't actually resolve. New `GET /companies/top`
      returns up to 5 companies, randomly selected for now (no
      volume/popularity signal exists yet to rank by — a real ranking
      is a future follow-up); the landing page's grid switches to it
      (GitHub issue #415, D68)

## Phase 35 — Moderated Company Creation & Moderator Search

Filed 2026-07-26, from direct user feedback on issue #360's
create-company-request flow: `POST /companies` has never been
moderation-gated (a real gap predating Phase 16, `Company` has no
`candidateId` so it was never on that phase's write-path list, and
issue #217/D38 only added session + rate-limit gating, not a
moderation queue) — every new company is public and searchable
instantly, contradicting CLAUDE.md hard constraint #2 ("every review/
rating write goes through moderation before it's public"). Separately,
the moderation queue itself has no search/filter capability at all —
finding one entry among many means scrolling the whole grouped list.
Four design decisions resolved directly with the project owner before
filing:
- `Company` gets a real `status` column (reusing the existing
  `ModerationStatus` enum — pending/approved/rejected/flagged),
  mirroring `RoundRating`/`RecruiterRating`/`OverallReview` exactly,
  rather than a separate "request" table — the row exists immediately,
  just hidden from every public read until approved.
- The moderator's new fuzzy search/filter box is backed by a **new
  dedicated OpenSearch index** over the moderation queue itself
  (indexed on entry, removed on resolution — same best-effort,
  non-blocking D16/D17 pattern), not Postgres trigram matching.
- The category filter is **two buckets**: "interview-review" (round
  rating + recruiter rating + overall review, combined) vs.
  "create-company request" — not four separate per-entity-type values.
- A rejected company request's row is **kept** with `status=rejected`
  for an audit trail, not deleted — its slug stays permanently
  occupied unless an admin manually intervenes later, a deliberate
  trade favoring audit history over slug reuse.

Also motivated by the same change: issue #360's auto-redirect into
`/write-review` after a successful company creation stops making sense
once the created company is pending, not public — it's replaced with a
plain confirmation modal, no navigation. Milestone "Phase 35 —
Moderated Company Creation & Moderator Search", issues #369-373 filed
under epic #368.

- [x] Company creation moves behind moderation: `Company.status`
      (migration), `CompaniesService.create()` enqueues instead of
      indexing immediately, every public read path (list/by-slug/
      analytics/reviews/search) filters to `approved` only,
      `ModerationService.review()` gains a fourth entity type
      (`company`) — approve indexes to the existing `companies`
      OpenSearch index, reject keeps the row as `rejected`; creating an
      `InterviewProcess` against a non-approved `companyId` is rejected
      (GitHub issue #369, D58)
- [x] New moderation-queue OpenSearch index + fuzzy search endpoint:
      one document per pending queue entry (category, company name,
      role title, free-text preview), indexed/removed alongside
      existing enqueue/resolve points across all four entity types;
      `GET /moderation/search?q=&category=` (GitHub issue #370, D59)
- [x] Moderation UI: a search box + two-bucket category filter on
      `/moderation`, calling the new endpoint; each result shows a
      category badge; existing per-entry approve/reject/flag controls
      reused (GitHub issue #371)
- [x] Confirmation modal replaces the create-company-request flow's
      auto-redirect into `/write-review` — a plain "request submitted"
      modal (OK + corner close), no navigation (GitHub issue #372)
- [x] Engineering blog (last) (GitHub issue #373)
- [x] Fix: legacy companies (created before issue #369's migration)
      were silently backfilled to `status: pending` by Postgres's
      `NOT NULL DEFAULT` column-add behavior, hiding every one of them
      from every public read path — a new data-fix migration marks
      anything created before that migration's own timestamp as
      `approved` (GitHub issue #381, D60)
- [x] Fix: `moderation_queue` entries orphaned by a raw-SQL entity
      deletion (bypassing `removeQueueEntries()`) rendered as
      "Unknown · Unknown" forever and 404'd with a raw Prisma error if
      actioned — `enrichEntries()`/`review()` now self-heal a genuinely
      missing entity instead. Also closed a deeper gap this surfaced:
      the general e2e suite had no guard against running against the
      dev database/real OpenSearch indices (only the smoke test did) —
      a new `jest-e2e.json` `globalSetup` now enforces both isolation
      knobs for the whole suite (GitHub issue #383, D61)
- [x] Fix: a create-company request could go permanently unsearchable
      via `/moderation/search` if its write-time OpenSearch indexing
      call (best-effort, D16/D17) failed or raced — still visible in
      `/moderation/queue` (Postgres), never in search, with nothing to
      retry it. `ModerationService.listPending()` now self-heals: since
      it already reads every pending entity fresh from Postgres on
      every queue load, it best-effort re-indexes each one (GitHub
      issue #416, D69)

## Phase 36 — Moderator Queue SLAs, Assignment & Notifications (not yet planned)

Raised alongside Phase 35's planning: the project owner is thinking
about queue SLAs (e.g. 48h in the beginning) once the moderation queue
gets real search/filtering (Phase 35), plus how request *assignment*
(which moderator owns which entry, once there's more than one
moderator) and SLA-breach *notifications* would work. Explicitly not
resolved or scoped now — no design decisions made, no issues filed —
per direct instruction to keep this parked for a future planning pass,
the same trigger-gated framing Phase 8's menu already uses. Real
open questions for whenever this gets planned: what "the SLA clock"
even starts from (entry creation? first moderator view?); whether
assignment is manual (a moderator claims an entry) or automatic
(round-robin/least-loaded); and what a breach notification looks like
given there's no current out-of-band channel (email via the existing
`mail/` module is the obvious candidate, but unconfirmed). Revisit once
there's a concrete trigger — e.g. Phase 35 shipping and the queue
actually needing this, or a second moderator account existing at all.

**Amendment (sketched 2026-07-29, from Phase 39's own brainstorm):**
also now a downstream consumer of Phase 39's flagged/ambiguous LLM
verdicts, once that phase exists — a new automatic ticket source
alongside today's manual-flag path. Doesn't resolve any of this
phase's own parked questions above, just adds a second thing capable
of creating a ticket.

## Phase 37 — Synthetic Data Seed Rollback (Undo by Run ID)

Filed 2026-07-27, from a direct follow-up question after using Phase
19 issue #164's `seed-demo-data` generator against the dev database:
there is currently no way to undo a seed run short of hand-deleting
rows and diffing OpenSearch, the exact class of manual cleanup D51/D61
already showed doesn't reliably happen at scale. The generator already
returns the `companyIds` it created in its JSON summary (D62's own
"identify your own data by id" discipline) — this phase turns that
into a real, self-contained rollback command instead of something the
caller has to act on by hand.

Design, worked out before filing (no open questions — this composes
existing, already-proven pieces rather than inventing new ones):

- Each `seed:demo-data` run generates a `runId` (UUID) up front and
  writes a local JSON manifest (`api/scripts/.seed-runs/<runId>.json`,
  gitignored) capturing `runId`, a timestamp, the `--companies` count,
  and the run's `companyIds`/`candidateIds` — the two anchors
  everything else in the run hangs off of. Deliberately a local file,
  not a new Postgres table: this is dev-tool bookkeeping for a
  lower-env-only script, not something that belongs in the production
  schema.
- A new `seed:demo-data:undo -- --run-id=<id>` (plus `--list` to
  enumerate available manifests without digging through old terminal
  output) reads the manifest and deletes everything that run created,
  in the same FK-safe order `MeService.eraseMe()` (Phase 17 issue
  #151) already uses for a single candidate, just scoped to a batch of
  companies/candidates instead of one: ratings/reviews and their
  `moderation_queue` entries → rounds/recruiter interactions →
  processes → candidates → companies (+ their own `moderation_queue`
  entries) — all in one transaction, same atomicity guarantee the seed
  script's own bulk-submission calls already rely on.
- Best-effort removes the matching `companies`/`reviews`/
  `moderation_queue` OpenSearch documents afterward (same D16/D17/D59
  never-block-on-search pattern), then refreshes the three
  materialized views, mirroring what the seed script itself does on
  the way in.
- Reuses `assertSeedTargetConfirmed()`'s exact guard (`interview_
  insights_test`, or an explicit `--i-know-this-seeds-fake-data`
  override) — undoing is exactly as destructive as seeding against the
  wrong database.

- [x] Implement `seed:demo-data:undo` — manifest writing on every seed
      run, the undo script itself (FK-safe deletion, search cleanup,
      materialized-view refresh, `--list`), and the shared safety
      guard reuse
- [x] Engineering blog (last)

Epic: GitHub issue #405 (issues #406-407).

Three real prerequisite gaps were found while checking this design
against the actual codebase, before implementation started, and fixed
as part of issue #406 rather than left as surprises: `Summary` only
tracked `companyIds`, not `candidateIds` (candidates were created but
their ids discarded); `CompanySearchService` had no delete/remove
method at all (only `indexCompany`/`search`); and this design's own
FK-safe deletion order omitted `Recruiter` rows, which the seed
generator does create and which have a real FK to `Company` with no
cascade — deleting a company first would have failed outright. See
`wiki/blog/phase-37-synthetic-data-seed-rollback/` for the full
writeup.

- [x] Fix: found via live-verification of Phase 35's moderator search —
      `seed-demo-data-undo`'s best-effort OpenSearch cleanup fired one
      unbounded `Promise.all` per run, thousands of concurrent deletes
      at real seed-run scale, enough to silently overwhelm a
      single-node OpenSearch and leave orphaned `moderation_queue`
      documents behind, burying genuinely pending search results (D70).
      Cleanup now batches (25 at a time); new
      `prune-orphaned-moderation-queue-search-docs.js` (mirroring D51)
      cleans up the resulting backlog, both live and reusable
      (GitHub issue #420, D70)

## Phase 38 — Company-Profile-Centric Review Browsing

Filed 2026-07-29, from direct product feedback: clicking a company
anywhere on the landing page (a quick-select link or a typed-search
result row) opened an inline "Browse reviews for {company}" panel on
the same page instead of going to that company's own profile, which
duplicated what the profile page already does. Clarified during
planning: the filtering capability that panel offered doesn't become
its own section on the profile page — it's merged directly into the
profile page's existing Reviews section, gated behind login the same
way the rest of that section already is (issue #226, Phase 21), with
no separate "Browse reviews" button or section anywhere. A pagination
bug was also found via live verification while scoping this work (on
the Gerhold - Schneider company profile): the Reviews section's
"Previous" button failed to correctly redisplay page 1 after paging
forward, since the fetch effect's `page === 1` skip-guard (meant only
to avoid a redundant fetch on first mount) also fired on every later
return to page 1. Milestone: "Phase 38 — Company-Profile-Centric
Review Browsing". Epic: GitHub issue #422.

- [x] Home page & search results: quick-select links and
      `CompanyResultRow`'s search-result rows navigate straight to
      `/companies/{slug}` instead of opening the inline browse-reviews
      panel; `CompanyResultRow` drops its "Browse reviews" button
      entirely (keeps "View profile" / "Write a review"); the inline
      panel and its state/handlers are removed from the landing page
      (GitHub issue #423)
- [x] Company profile page: review filtering (role title, round type,
      date range) merged into the existing Reviews section's own
      `GatedSection`, replacing the default grouped/paginated list with
      flat filtered results (`GET /search/reviews`, no backend change
      needed) while a filter is active; "Clear filters" restores the
      default view (GitHub issue #424)
- [x] Fix: the Reviews section's "Previous" pagination button left
      stale data when returning to page 1 — replaced the `page === 1`
      skip-guard with a ref tracking whether the slug's initial bundled
      fetch has completed, so every later page change (including a
      return to page 1) refetches correctly; also resets `page` to 1 on
      slug change to avoid the same stale-page class of bug when
      navigating directly between two companies' profiles (GitHub issue
      #425)
- [x] Engineering blog (last) (GitHub issue #426)

## Phase 39 — LLM Auto-Approval for High-Confidence Submissions

Sketched 2026-07-29 from a brainstorm about extracting moderator/
ticketing services into their own microservices (Phase 30-32, D53).
Deliberately does **not** depend on Phase 30-32's event bus — same
"prove the policy simply first" sequencing Phase 19 already used for
D66's advisory-only triage. Builds directly on today's in-process,
synchronous `AiModerationService` (D66); the logic travels into the
async `review-analyzer` service later, alongside Phase 32's own
extraction, same as the rest of D66's logic is already slated to.

Partially supersedes D66's "verdict never gates the write" — deliberately,
and only for the high-confidence-clean band; see D71. Every other D66
property (disabled by default, degrades silently on failure, content
rebuilt fresh from Postgres) is unchanged and still governs everything
that doesn't clear the auto-approve cutoff. Deliberately kept as its
own phase rather than folded into Phase 32: Phase 32 is a location
change (move D66's existing logic async); this is a policy change
(what the logic is allowed to decide) — keeping them separate means
either can ship or be rolled back independently. Milestone: "Phase 39 —
LLM Auto-Approval for High-Confidence Submissions". Epic: GitHub issue
#436.

**Kickoff brainstorm resolved 2026-07-29** (GitHub issue #437, D71):
single hard confidence cutoff (not the three-tier clean/ambiguous/
concerning shape originally sketched — anything below the cutoff stays
`pending`/advisory-only exactly as D66 already behaves today, so the
"ambiguous" band and its Phase 36 ticket-queue integration were
dropped); no numeric starting threshold committed here, it ships as an
env-var-driven config value tuned empirically; all three D66-covered
entity types (`RoundRating`/`RecruiterRating`/`OverallReview`) ship
together, not a `RoundRating`-only rollout; durable audit log is a new
dedicated table, not an extension of the mutable per-entity
`moderationVerdict` JSONB column; kill switch is a single global env
var; reconciliation sweep re-triages/escalates any `pending` row with
no verdict past 24h.

- [x] Kickoff brainstorm: threshold model, entity-type rollout order,
      audit log shape, sweep SLA (GitHub issue #437)
- [x] Extend D66's verdict shape with a confidence score; single-cutoff
      auto-approve routing logic (GitHub issue #439)
- [ ] System-attributed auto-approve path: `AiModerationService` calls
      `ModerationService.approve()` for clean verdicts, attributed to a
      system actor, durably audited in a new dedicated table (never
      best-effort/swallowed the way D16/D17's search indexing is)
      (GitHub issue #440)
- [ ] Config-driven kill switch (single global env var) forcing every
      verdict back to D66's original advisory-only behavior, no deploy
      needed (GitHub issue #441)
- [ ] Reconciliation sweep: scheduled job re-triages or escalates any
      `pending` row past 24h with no verdict yet — closes the
      "lost/never-ran triage" gap without a transactional outbox
      (GitHub issue #442)
- [ ] Engineering blog (last) (GitHub issue #443)
