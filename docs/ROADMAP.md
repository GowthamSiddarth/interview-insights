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
- [x] Branch protection on `main` requiring CI checks (GitHub issue #18) —
      originally found blocked on this private repo's free plan; that
      read was too broad — reworked 2026-08-10 into a config that
      actually fits a solo owner (PR required, all 6 `ci.yml` job
      contexts required green, 0 required approvals, no admin-bypass
      click needed). See D98
- [x] Engineering blog (`wiki/blog/phase-6-cicd-containerization/`, PR #38,
      GitHub issue #52) — originally covered #17 and #18 while #18 was
      still blocked; #18's later 2026-08-10 resolution didn't get its own
      post (no PR/commit trail — a repo-settings-only change, not a code
      change — and no new D-number), consistent with this project's
      "not every reopen gets its own post" precedent

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

## Phase 20 — Operational Hardening & Live-Verification Findings (retired, split into 20a–20e)

Filed retroactively, 2026-07-24, per a new standing convention: every
ad-hoc dev/test/structural task — not just planned `docs/ROADMAP.md`
feature work — gets tracked under an Epic, even when the work itself
already happened before the issue existed. Reused as that catch-all
repeatedly for over two weeks (2026-07-24 through 2026-08-09) until it
had grown to ~32 unrelated issues under one epic (#214) and one
milestone. Split 2026-08-09 into five narrower, thematically coherent
phases (20a–20e below) so the epic/milestone/blog structure actually
tracks what each item is about, rather than "everything ad-hoc that
happened during this stretch." Epic #214 and the original "Phase 20"
milestone stay closed as the historical record of this phase before
the split — see `wiki/blog/phase-20-operational-hardening/README.md`
for the same pointer on the blog side. Every bullet below kept its
original GitHub issue number, PR, and D-number; only the phase/epic/
milestone grouping changed.

- [x] Retire local `podman-compose` full-stack path — `infra/
      docker-compose.yml`'s Postgres kept colliding with `kind`'s on
      port 5432 (D24's silent-wrong-target failure recurring years
      later), most recently 2026-08-10 when a bare `npx prisma migrate
      deploy` landed on the stray compose instance instead of `kind`'s.
      `kind` is now the sole local Postgres/OpenSearch/Mailpit/
      Redpanda/LocalStack instance; the file is deleted outright rather
      than re-documented as unused again. Filed and merged against this
      original epic (#214) rather than one of 20a-20f below — landed
      2026-08-10, after the 20a-20e split above, an exception to this
      epic/milestone's own "stays closed as historical record" note
      (GitHub issue #578, D97)
- [x] Move `cd-hetzner.yml`'s `deploy` job, and the `api`/
      `notification-service`/`review-analyzer` image builds still left on
      the self-hosted Mac after #708/D111, fully off it — the three
      builds move into a `build-images` matrix job on `ubuntu-latest`
      (same GitHub-hosted rationale D111 already used for `web`'s build,
      genuinely native x86_64 and genuinely parallel, vs. ~6 min
      sequential podman builds under emulation); `deploy` moves to
      `ubuntu-latest` too, since its only remaining tie to the Mac was
      holding the SSH private key needed to reach the pilot's k3s API
      (port 6443 is closed in the firewall, #659; SSH is the only path
      in, #668) — that key is now the `HETZNER_SSH_PRIVATE_KEY` repo
      secret (`docs/SECRETS.md`), and `deploy` opens its own ephemeral
      tunnel instead of reusing the Mac-only `launchd`-based tunnel
      script (which is untouched, and still what the operator's own
      manual/interactive cluster access uses). Also fixed a latent
      `sed -i ''` (BSD-only) bug the runner switch would otherwise have
      hit on Linux, and dropped two steps that no longer apply off the
      persistent Mac (the disk-pressure gate, a stale podman-prune
      step). Full pipeline runtime dropped from ~10m30s to ~3m21s,
      confirmed live end to end (`https://api.interviewinsights.fyi`
      still serving real trusted TLS post-deploy) — GitHub Actions run
      32402977802. `cd-hetzner.yml` no longer depends on the self-hosted
      Mac being on or reachable at all. Filed and merged against this
      original epic (#214) rather than one of 20a-20f below, same
      exception the #578 bullet above already used (GitHub issue #770,
      PR #771)

### Phase 20a — CD/Infra Disk & Build Hygiene

Docker/Podman disk-fills-up-and-crash-loops incidents and their fixes —
the same failure mode (`api` crash-looping on OpenSearch's flood-stage
watermark once local disk fills) recurring three times over the phase
before finally getting a proactive gate + monitoring instead of a
reactive prune each time. Milestone: "Phase 20a — CD/Infra Disk & Build
Hygiene". Epic: GitHub issue #556.

- [x] Prune stale Docker artifacts after every CD deploy — five days of
      CD runs had filled the shared Docker Desktop disk to 96%,
      tripping OpenSearch's flood-stage watermark and crash-looping
      `api` on an unrelated merge (no real outage). `cd.yml` gained a
      cleanup step; a near-miss with node-internal `crictl rmi --prune`
      documented as the reason host-level Docker cleanup is used
      instead (PR #210, GitHub issue #215, D35)
- [x] `infra/scripts/prune-kind-node-images.sh` safely prunes the kind
      node's own orphaned images — cross-references every pod's actual
      running image digest cluster-wide before removing anything
      (never a blind `crictl rmi --prune`, per D35's own near-miss),
      wired into `cd.yml` as a second prune step; verified live against
      the real incident, freeing the node's disk from 91% to 45% and
      unblocking the stuck deploy (GitHub issue #240, D43) — the exact
      same crash signature came back from a disk D35's fix never
      covered: the kind node's own internal containerd store, filled by
      repeated `kind load docker-image` calls across a single heavy day
- [x] Tighten CD's Docker/build-cache prune cadence — the existing 48h
      filter is too loose for current merge/build volume (GitHub issue
      #530) — third occurrence of D35/D43's failure mode; shortened to
      `until=6h`; see D85
- [x] Add a pre-flight disk-usage gate to `cd.yml` before Docker builds
      (GitHub issue #531) — fails fast at 85% disk usage before any
      build starts; see D86
- [x] Daily launchd health-check job: proactive disk monitoring +
      auto-prune for the self-hosted CD runner (GitHub issue #532) —
      `infra/scripts/disk-health-check.sh`, 70%/80% thresholds, see D87
- [x] Engineering blog: existing posts for #215 (D35) and #240 (D43)
      carried over from the original Phase 20 blog; #530/#531/#532
      never got individual posts (no new design decision beyond
      D85-D87's own writeup in `docs/DECISIONS.md`), same "not every
      reopen gets its own post" precedent the original Phase 20 set

### Phase 20b — Docker → Podman Migration

A clean, self-contained project arc: replace Docker/Docker Desktop with
Podman across local dev, `kind`, and CD, one layer at a time with an
explicit decision gate at each step (D83-D93). The newest of the five
groups — finished with #553/#554 just before this split. Milestone:
"Phase 20b — Docker → Podman Migration". Epic: GitHub issue #557.

- [x] Switch local dev container engine from Docker to Podman (GitHub
      issue #496) — `infra/docker-compose.yml` only, `kind`/CI/CD
      explicitly out of scope; see D83 (PR #538)
- [x] Spike: verify `kind` can run on Podman before further Docker
      removal (GitHub issue #539) — **failed**: control-plane node
      never reached `Ready` (rootless-Podman cgroup delegation) and
      `kind load docker-image` couldn't find a Podman-built image;
      issue's own decision gate fired, so #540/#541 below are blocked
      until a rootful `podman machine` is re-tested; see D84
- [x] Re-test `kind` on a **rootful** `podman machine` — retry of
      #539's spike against the untested variable D84 called out
      (GitHub issue #545) — **mixed**: node health and image loading
      (via a `podman save | kind load image-archive` workaround) are
      now fixed, but `extraPortMappings` (ingress host ports 80/443)
      newly failed, never having been reached by #539; #540/#541 stay
      blocked on that narrower gap instead; see D88
- [x] Diagnose/fix `extraPortMappings` under kind's (experimental)
      podman provider — the one remaining gap D88/#545 found, blocking
      #540/#541 below (GitHub issue #547) — **root cause found: D88's
      own spike had a pod port mismatch (declared `hostPort` not
      matching the test image's actual listening port), not a platform
      gap**; corrected config forwards end-to-end (node-internal and
      full host path) repeatably; #540/#541 unblocked, pending real
      ingress-nginx/80/443 parity verification as part of whichever is
      picked up first; see D89
- [x] Migrate `cd.yml` and the self-hosted runner off Docker onto
      Podman (GitHub issue #540) — unblocked by D89; code/docs migration
      (`cd.yml`, `bootstrap-kind.sh`, prune/disk-health scripts,
      `wiki/deployment-guide.md`), see D90. Live-verified for real: the
      updated `bootstrap-kind.sh` run against a rootful `podman machine`
      surfaced three genuine gaps (broken `kind get clusters` under this
      Podman version — hit twice, once in `bootstrap-kind.sh` and again
      in `self-hosted-smoke-test.yml`'s own liveness check; the
      `docker.io/library/` retag requirement on top of D88/D89's
      `image-archive` workaround; and 2GB being too little `podman
      machine` memory for the full stack) — all three found and fixed,
      see D91. **80/443 production parity confirmed against the real
      chart**, closing D89's own open caveat; golden-path check (D36)
      and the self-hosted-runner smoke test both green against the
      redeployed cluster. PR #550
- [x] Remove Docker Desktop entirely: final re-verification + docs
      update (GitHub issue #541) — live-verified with Docker Desktop
      quit: cluster/pods/podman-machine healthy, ingress 80/443
      reachable, golden-path smoke test 15/15; found and fixed an
      unrelated gap along the way (`interview_insights_test` database
      had never been created on this cluster); uninstalled via `brew
      uninstall --cask docker`; see D93
- [x] Runbook: `app.interview-insights.local` intermittently unreachable
      despite healthy pods (GitHub issue #564) — live incident, bisected
      to `podman-machine-default`'s own kernel network stack degrading
      (not Podman port-forwarding, not kind, not the app); fixed by a
      `podman machine` restart. Documented as
      `wiki/deployment-guide.md` §11.11
- [x] Engineering blog for Phase 20b (GitHub issue #561) — six posts, one
      per issue (D83, D84, D88, D89, D90/D91, D93), unlike 20a/20c/20d/
      20e's "not every reopen gets its own post" precedent — every issue
      in this arc introduced a real design decision

### Phase 20c — Live-Verification Tooling & Data Hygiene

Infra/scripts that make live verification itself safe and repeatable,
plus the bugs that live verification (the golden-path smoke test's own
stress-testing, a port-forward reliability gap, an OpenSearch/Postgres
drift check) surfaced along the way. Milestone: "Phase 20c —
Live-Verification Tooling & Data Hygiene". Epic: GitHub issue
#558.

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
- [x] `api/scripts/prune-orphaned-company-search-docs.js` diffs the
      `companies` OpenSearch index against Postgres and bulk-deletes
      anything with no matching row — a live sweep found 415 such
      orphans (420 documents against 5 real rows), all accumulated from
      test-cleanup sessions that only ever deleted the Postgres row
      (D44's existing pattern) and never re-synced the index; deleted
      the 415 confirmed orphans directly and added the script so this
      doesn't require trusting a purely manual checklist step going
      forward (GitHub issue #278, D51)
- [x] `infra/scripts/dev-port-forwards.sh` wires the local Postgres/
      OpenSearch/Mailpit port-forwards into macOS launchd LaunchAgents
      instead of plain backgrounded `kubectl port-forward` jobs, which
      only survive as long as the shell that started them — unreliable
      across separate AI-assisted tool-call shells, confirmed dying
      repeatedly during Phase 28's live verification. `KeepAlive`
      auto-restarts a forward if it ever exits; verified persistence
      directly by `exec`-ing into a fresh shell and confirming the
      forwards were still listening (GitHub issue #312)
- [x] `infra/scripts/dev-port-forwards.sh` never wired up Redpanda
      (Postgres/OpenSearch/Mailpit only), so the two e2e specs that talk
      to a real broker only ever passed in CI, failing locally with
      `KafkaJSConnectionError`. Redpanda's k8s `Service` only exposed
      the in-cluster port; added a `kafka-external` (19092) port
      matching docker-compose's own exposed port, so
      `dev-port-forwards.sh` treats it like the other three services
      (PR #520, GitHub issue #519)
- [x] `infra/aws/seed-localstack.sh` didn't URL-encode `$POSTGRES_PASSWORD`
      when building `DATABASE_URL` (GitHub issue #551) — found live while
      verifying #540 (D91): `wiki/deployment-guide.md` 5d's own rotation
      command (`openssl rand -base64 24`) can produce `/`, `+`, or `=`,
      breaking `postgresql://` URL parsing (`P1013: invalid port number
      in database URL`). Fixed by percent-encoding the password before
      interpolating it into `DATABASE_URL_VALUE`; see D92
- [x] Engineering blog: existing posts for #216 (D36), #212 (D37), #278
      (D51), and #312 carried over from the original Phase 20 blog;
      #519/#551 never got individual posts, same "not every reopen
      gets its own post" precedent

### Phase 20d — Product/UX Polish from Live Verification

User-facing findings from actually using the product (not infra) — a
mix of live-verification catches and direct user follow-up requests on
the same `/me`/company-profile UI. Milestone: "Phase 20d — Product/UX
Polish from Live Verification". Epic: GitHub issue #559.

- [x] Honest login-page copy + lock down `POST /companies` — the login
      form already always upserts a candidate but its copy read as
      login-only; `POST /companies` had neither a session requirement
      nor rate limiting, an anonymous-write gap predating Phase 16
      entirely since `Company` has no `candidateId` (PR #219, GitHub
      issue #217, D38)
- [x] Session cookies gain an explicit shared `Domain` (`COOKIE_DOMAIN`)
      so `web`'s NavBar/wizard session checks actually see a real login
      on any deployed environment — a user-reported bug ("nav bar shows
      log in even after login") traced to session cookies being
      host-only, invisible to `web`'s JS on any deployed environment
      where `web`/`api` don't share a hostname; verified via
      `Set-Cookie` through the real Ingress and a live headless-browser
      run confirming "Log out" renders correctly (GitHub issue #222,
      D39)
- [x] Public company Reviews section groups approved round ratings by
      their submission (`InterviewProcess`), not raw row count — a
      user report found a 3-round submission plus 1 separate one
      showing as "4 reviews" instead of the real 2; the same flat-list
      problem Phase 29 issue #315 already fixed for the moderation
      queue. Pagination moves with the grouping (submissions, not raw
      rows, so one submission's rounds are never split across a page
      boundary) (GitHub issue #347, D54)
- [x] `/me`'s process card labels its own outcome distinctly from
      moderation status — a bare "Rejected" (the process's own
      self-reported outcome) read as a sixth moderation verdict
      alongside five real ones, especially confusing when it was the
      opposite of what every actual status said. Now `Outcome:
      Rejected`, copy-only (GitHub issue #349, D55)
- [x] `/me`'s process cards collapse by default and expand on click —
      direct user request to match the moderation queue's own
      collapsed-by-default / expand-on-click pattern (GitHub issue
      #385)
- [x] Fix: "View details" and "View company profile" (issue #385's own
      layout) rendered on visibly separate lines on narrower viewports
      — `flex-1`'s zero flex-basis never triggered a wrap, so a long
      title just shrank the toggle button instead of wrapping,
      stranding "View details" far from the profile link. Grouped both
      labels into one flex sub-container that can't split apart, with
      the title stacking full-width above them below the `sm`
      breakpoint (GitHub issue #387)
- [x] "View details" is now the actual clickable toggle (a hyperlink-
      styled button), not the whole title row — direct user follow-up
      request; the title block is now plain static text (GitHub issue
      #389)
- [x] Engineering blog: existing posts for #217 (D38), #222 (D39), #347
      (D54), and #349 (D55) carried over from the original Phase 20
      blog; #385/#387/#389 never got individual posts (copy/layout-only
      follow-ups, no new design decision), same "not every reopen gets
      its own post" precedent

### Phase 20e — Config, Secrets & Build Correctness Bugs

Grab-bag of real correctness bugs found in config/build/secrets
plumbing — each one a case where something silently did the wrong
thing (a threshold parsed as `0` instead of "unset", a JSON parse that
silently swallowed a markdown fence, module-import-order-dependent env
loading) rather than failing loudly. Milestone: "Phase 20e — Config,
Secrets & Build Correctness Bugs". Epic: GitHub issue #560.

- [x] No plaintext secrets anywhere in git — extended the LocalStack
      Secrets Manager pattern already proven for `DATABASE_URL`/
      `EMAIL_HASH_SECRET` (issue #78/#79) to `EMAIL_ENCRYPTION_KEY`/
      `CANDIDATE_JWT_SECRET`, built the equivalent for
      notification-service (own bootstrap, own IAM role, D73/D75's
      duplicate-rather-than-share precedent) — a direct user request
      following issue #335's `EMAIL_ENCRYPTION_KEY` addition, not a
      live-verified incident like this phase's earlier items. Also the
      origin of CLAUDE.md hard constraint #6 (no secret ever committed
      as plaintext, not even a placeholder). Both open design questions
      the issue flagged, resolved and documented rather than silently:
      the once-separate `dev-localstack` overlay is folded into `dev`
      itself, which now requires LocalStack unconditionally — no more
      plaintext-Secret escape hatch to opt out into (D76); and
      `postgres-credentials` — needed before any app code exists to
      fetch a secret for it — is provisioned imperatively, same pattern
      as `admin-credentials` (D77) (GitHub issue #466)
- [x] Fix: `api/scripts/*.ts` files were being pulled into `nest
      build` (`tsconfig.build.json` had no exclusion for `scripts`),
      shifting every compiled `dist/` output path and crash-looping the
      deployed pod on the very next CD run — `tsconfig.build.json` now
      excludes `scripts` explicitly (GitHub issue #393, D63)
- [x] Trim `CLAUDE.md`'s "Current status" section (233K chars of
      append-only phase history) into a lean root file plus
      `api/CLAUDE.md` and `web/CLAUDE.md` scoped files; also wrote down
      the ad-hoc-work-under-an-epic convention itself as an explicit
      `CLAUDE.md` bullet (previously only a narrative aside), with a
      concrete runbook in `wiki/github-project-setup.md` (PR #414,
      GitHub issue #413)
- [x] `getAutoApprovalConfidenceThreshold()` treated an explicit
      empty-string `AI_MODERATION_AUTO_APPROVE_THRESHOLD` (this
      project's own "disabled" convention) as threshold `0`, not
      "unset" (`Number('')` is `0`, not `NaN`) — every clean AI verdict
      became auto-approve-eligible even with the kill switch on. Also
      wired `AI_AUTO_APPROVAL_ENABLED`/the threshold into
      `docker-compose.yml`/`05-api.yaml` (previously only documented in
      `.env.example`, no real deploy path to set them), added
      `api/.dockerignore` (a real local `.env` was baking into the
      image), and extended `wiki/deployment-guide.md` section 5c into a
      full enablement walkthrough (PR #451, GitHub issue #450)
- [x] AI moderation triage failed on every real Claude response —
      `AiModerationService.requestVerdict()` called `JSON.parse()`
      directly, but a real `claude-haiku-4-5` response wraps the JSON
      verdict in a markdown code fence despite the system prompt asking
      for none; silently swallowed by D66's existing best-effort
      handling, leaving `moderationVerdict` pending forever. Never
      caught by the test suite since every mock built its response via
      `JSON.stringify()`, never fenced (PR #454, GitHub issue #453)
- [x] Native dev boot could crash on a genuinely-set `.env` var,
      depending on module import order — `getRequiredAdminEnv(
      'ADMIN_JWT_SECRET')` is read eagerly at `admin-auth.module.ts`
      module-evaluation time, but nothing in `api/src` called `dotenv`
      explicitly; `.env` only ever reached `process.env` as an
      incidental side effect of `@prisma/client`'s own auto-loading,
      and `app.module.ts` imports `AdminAuthModule` before
      `PrismaModule`. `import 'dotenv/config'` as `main.ts`'s first
      import removes the reliance on that ordering; a new smoke test
      boots the real app from only a throwaway `.env` file (PR #455,
      GitHub issue #452)
- [x] `web/tests/*.spec.tsx` flagged IDE/`tsc` errors (`Cannot find
      name 'describe'/'it'/'expect'`) since `@types/jest` was never a
      real dependency — jest's own runtime globals meant `npm test`
      always passed regardless, masking the gap; also stopped tracking
      `tsconfig.tsbuildinfo` (TypeScript's incremental-build cache) (PR
      #483, GitHub issue #482)
- [x] LocalStack's init hook reseeded a stale default Postgres password
      on every restart instead of the real (possibly rotated) one
      (GitHub issue #563) — live incident, silently P1000-crash-looped
      api/notification-service/review-analyzer for days before
      surfacing; fixed by wiring the real `postgres-credentials` Secret
      into LocalStack's pod, same pattern D78 already used for
      admin/anthropic secrets; see D94
- [x] `postgres-credentials`'s `POSTGRES_PASSWORD` key found empty (0
      bytes) in the live cluster, a distinct failure mode from #563's
      stale-value reseed — crash-looped `api` twice the same day #563/
      #565 merged (GitHub issue #568). Root cause confirmed on the
      second occurrence: a race between CD's "Provision Postgres
      credentials secret" step resolving `${{ secrets.POSTGRES_PASSWORD
      }}` and a concurrent `gh secret set POSTGRES_PASSWORD` landed
      mid-write, resolving empty. Live-fixed both times by rotating the
      password via local trust auth and resyncing `postgres-
      credentials`, LocalStack's `database-url` secret, and (second
      time) the GitHub repo secret together; CD now hard-fails on an
      empty resolved value instead of applying it — see D95
- [x] Engineering blog: existing post for #466 (D76, D77) carried over
      from the original Phase 20 blog; #393/#413/#450/#453/#452/#482
      never got individual posts, same "not every reopen gets its own
      post" precedent
- [x] `api/.env.example`'s `ADMIN_PASSWORD_HASH`/`ADMIN_JWT_SECRET`
      still carry a real-looking bcrypt hash and a "dev-only-change-me"
      fallback, violating D78/hard-constraint-6 — D78 (issue #466)
      migrated both vars to LocalStack Secrets Manager specifically so
      `.env.example` would carry no placeholder for them, but PR #476
      never touched the file. Found during Phase 20f's admin-env audit,
      filed separately under this epic per the ad-hoc-work convention
      (GitHub issue #576). Both vars now ship as `""` in `.env.example`
      with no committed placeholder at all, matching D78's original
      intent — a real dev-only value still lives in
      `wiki/deployment-guide.md` §5b for developers to copy into their
      own untracked `api/.env`
- [x] Self-service admin-credential rotation script
      (`infra/scripts/rotate-admin-credentials.sh`) — consolidates §5b's
      manual `gh secret set`/`kubectl create secret`/
      `seed-localstack.sh`/`rollout restart` sequence into one
      idempotent script for whenever the deployed admin password is
      lost or needs rotating, rather than re-deriving the sequence by
      hand each time. Filed separately under this epic per the
      ad-hoc-work convention (GitHub issue #582)
- [x] `rotate-admin-credentials.sh` never exported `POSTGRES_PASSWORD`
      before calling `seed-localstack.sh` (which defaults it to the
      literal `postgres` when unset) — same root-cause class as #563's
      stale-password reseed (D94), but a separate code path D94 never
      touched. Live incident during Phase 42's final deployment
      verification: running the script exactly as documented
      crash-looped `api` with a Prisma P1000 error right after its own
      "successfully rolled out" message. Fixed the same way D94 fixed
      `seed.sh` — read `POSTGRES_PASSWORD` from `postgres-credentials`
      itself inside the script, never rely on the caller's shell. Filed
      separately under this epic per the ad-hoc-work convention (GitHub
      issue #604)

### Phase 20f — Retire Local Test-Database Isolation

Raised 2026-08-10: with only one local Postgres/OpenSearch environment
(`kind`'s, no staging/prod yet — Phase 8b) and the dev database holding
nothing but the operator's own synthetic/seed data, the separate
`interview_insights_test` database (D24/D61/D65) and its guard
machinery were judged not worth the ongoing complexity relative to the
risk they protect against today. Explicitly not filed under this
phase's own new epic per the ad-hoc-work convention exception this
project already carries for genuinely small items — this one *is* its
own themed unit of work (isolation-guard removal + doc rewrite across
~15 files), same reasoning Phase 20's original split into 20a-20e used.
Milestone: "Phase 20f — Retire Local Test-Database Isolation". Epic:
GitHub issue #571 (see D96 in `docs/DECISIONS.md` for the full decision
record).

- [x] Remove `assertUsingTestDatabase()`/`assertLocalE2eIsolation()`/
      `assertOpenSearchIndicesIsolated()` (`api/test/support/
      assert-test-database.ts`, deleted); rename `truncateTestDatabase()`
      → `truncateDatabase()` (`truncate-database.ts`), keeping its
      `DELETE FROM`/`REFRESH MATERIALIZED VIEW` behavior but now against
      whatever `DATABASE_URL` points at (the dev database); remove
      `assertSeedTargetConfirmed()` and every
      `--i-know-this-seeds-fake-data` call site
      (`seed-cli-utils.ts`/`seed-demo-data.ts`/`seed-demo-data-undo.ts`
      and their specs); update `golden-path.smoke-spec.ts`/
      `env-load-order.smoke-spec.ts` accordingly. See D96 (GitHub issue
      #572)
- [x] Update README.md and `wiki/deployment-guide.md` (sections 1, 6.1,
      6.3, 6.4, 8, 11.5–11.7) to match — no more
      `interview_insights_test`/`OPENSEARCH_INDEX_PREFIX`/
      `--i-know-this-seeds-fake-data` instructions; document that e2e/
      smoke runs now truncate the dev database directly, every time
      (GitHub issue #573)
- [x] Engineering blog (last) (GitHub issue #574) —
      `wiki/blog/phase-20f-retire-local-test-database-isolation/`; only
      #572 (D96) got its own post, #573 (docs update) didn't, same
      "not every reopen gets its own post" precedent as 20a/20c/20d/20e

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

- [x] Add Redpanda to local infra (docker-compose + k8s), mirroring
      how OpenSearch was added in Phase 5 (GitHub issue #330)
- [x] Shared event-publishing module (`api/src/events/`) + a versioned
      event-schema contract, best-effort/after-commit per D16/D17
      (GitHub issue #331)
- [x] Wire creation + moderation status-change events for all three
      moderated entity types, in both the single-create and
      bulk-submission paths (GitHub issue #332)
- [x] Ad-hoc: `DomainEventPublisher` reconnect-on-recovery — surfaced in
      a design review of #330-#332; today a Redpanda connection lost (or
      never established) at boot never retries, so events silently drop
      until the app restarts even after the broker recovers. Filed under
      this phase's own epic per the ad-hoc-work convention, not the
      Phase 20 catch-all, since it's specific to this phase's own
      plumbing (GitHub issue #459)
- [x] Ad-hoc: fix Redpanda `CrashLoopBackOff` — `09-redpanda.yaml` used
      `command:` (overrides the image's Docker `ENTRYPOINT`, bypassing
      `/entrypoint.sh` and the `rpk` translation layer that understands
      `--mode`/`--kafka-addr`/etc) instead of `args:` (overrides `CMD`,
      keeps the entrypoint); the raw seastar binary invoked directly
      doesn't recognize `--mode` at all, so the broker never came up.
      Also gave `api`'s ConfigMap the `REDPANDA_BROKERS: redpanda:9092`
      entry `notification-service`'s already had (it was silently
      falling back to the docker-compose-only `localhost:19092`
      default). Filed under this phase's own epic, same pattern as
      #459 (GitHub issue #478)
- [x] Engineering blog (last) (GitHub issue #333)

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

- [x] `notification-service` skeleton + its own Dockerfile/k8s
      manifest/CD step (GitHub issue #334)
- [x] Consume `*.created` events → "your submission is pending review"
      email, idempotent (GitHub issue #335)
- [x] Consume `*.status_changed` events → approved/rejected
      notification, idempotent (GitHub issue #336)
- [x] Engineering blog (last) (GitHub issue #337) — `wiki/blog/
      phase-31-notification-service/`, one post per issue (#334, #335,
      #336), same convention Phase 30's own blog issue (#333) used

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

**Kickoff brainstorm resolved 2026-08-02** (GitHub issue #338, D81):
write-back happens via a new `moderation.<type>.verdict_computed.v1`
event, not a shared-DB write or an internal HTTP call —
`review-analyzer` computes and publishes the verdict only; `api` gets
its first-ever event consumer, which writes `moderationVerdict` and
runs the existing (D71) `approveWithAudit()` auto-approval flow for
high-confidence verdicts. `FraudChecksService`'s synchronous checks are
unchanged and unaffected — review-analyzer's verdict stays a secondary,
arrives-later opinion alongside it, never a replacement. LLM/API choice
stays Anthropic's Claude API, unchanged from D66, with its own
LocalStack secrets bootstrap (D73/D75 precedent) rather than sharing
`api`'s credential.

- [x] Kickoff brainstorm: review-analyzer's relationship to
      `FraudChecksService`, LLM choice, data ownership (GitHub issue
      #338)
- [x] `review-analyzer` service skeleton, consumes `*.created` events
      (GitHub issue #339) — `services/review-analyzer/`, own Deployment/
      Dockerfile/CD step, own Redpanda consumer group subscribing to all
      three `moderation.*.created.v1` topics; logs receipt only, no
      DB/secrets yet — the real LLM triage logic lands in #340
- [x] Port Phase 19 issue #163's LLM-assisted triage into
      review-analyzer as an async, arrives-later enrichment, publishing
      `moderation.<type>.verdict_computed.v1`; `api` gains its first
      event consumer to apply the verdict and run existing (D71)
      auto-approval — never auto-approves/rejects itself, hard
      constraint #2 stays intact (GitHub issue #340, D81). Also removed
      the old in-process synchronous triage call sites and Phase 39's
      `ReconciliationSweepService` from `api` entirely (ported to
      review-analyzer, publishing a `stalled: true` escalation event
      instead of calling `ModerationService.flag()` directly) — see
      D81's addendum for both resolutions.
- [x] Engineering blog (last) (GitHub issue #341)

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

## Phase 36 — Moderator Queue SLAs, Assignment & Notifications

Raised alongside Phase 35's planning: the project owner is thinking
about queue SLAs (e.g. 48h in the beginning) once the moderation queue
gets real search/filtering (Phase 35), plus how request *assignment*
(which moderator owns which entry, once there's more than one
moderator) and SLA-breach *notifications* would work. Was explicitly
parked (no design decisions, no issues) until a future planning pass —
that pass happened 2026-07-31, triggered by a direct request to plan
it, resolving the open questions below:

- **SLA clock start**: entry creation (`ModerationQueueEntry.createdAt`
  + configurable hours, default 48h) — not first moderator view, which
  would need a new view-tracking event that doesn't exist.
- **Assignment model**: manual claim only. `AdminAuthService` today is
  a single shared credential, not a user table (Phase 18 scope note,
  `api/src/admin-auth/admin-auth.service.ts`), so round-robin/
  least-loaded auto-assignment is moot with one moderator — but a real
  `Moderator` identity table is introduced this phase so `claim`/
  `reviewedBy` become real FKs, not free text, unblocking a second
  moderator later.
- **Breach notification channel**: email, by extending Phase 31's
  `notification-service` consumer with a new
  `moderation.queue.sla_breach.v1` topic — reuses the one out-of-band
  channel that already exists rather than standing up new infra.

Milestone: "Phase 36 — Moderator Queue SLAs, Assignment & Notifications"
(#37). Epic: GitHub issue #484.

- [x] Add Admin/Moderator identity table, replace shared admin
      credential (GitHub issue #485) — `moderators` table
      (id/username/passwordHash/email/createdAt), `AdminAuthService`
      now queries it instead of comparing `ADMIN_USERNAME`/
      `ADMIN_PASSWORD_HASH` directly; `onModuleInit` upserts the
      env-configured moderator on every boot so login keeps working
      and secret rotation still takes effect immediately.
      `AdminSessionPayload` gained `id` alongside `username`, laying
      the FK groundwork #486/#487 need
- [x] Add SLA deadline + claim fields to `ModerationQueueEntry`
      (GitHub issue #486) — `sla_deadline` (`created_at` + configurable
      `MODERATION_SLA_HOURS`, default 48, computed by
      `ModerationService.enqueue()`/`reenqueue()`), `claimed_by` (real FK
      to `moderators`, nullable, `ON DELETE SET NULL`), `claimed_at`.
      Hand-authored migration (`migrate deploy`, same D64 shadow-DB
      workaround as #485's). Claim/release itself is #487
- [x] Claim/release endpoints + moderation queue UI affordance
      (GitHub issue #487) — `POST /moderation/queue/:id/claim` and
      `/release`, always attributed to the authenticated caller
      (`AdminJwtAuthGuard`'s own `req.user`, never a client-supplied id).
      Claiming an already-claimed or already-reviewed entry 409s;
      releasing someone else's claim 403s; releasing an unclaimed entry
      409s. `GET /moderation/queue` and `/search` now join the claiming
      `Moderator`'s username in alongside `claimed_by`/`claimed_at` so
      the UI never needs a second lookup. `EntryActions` gained a Claim
      button (unclaimed), a "claimed by you"/"claimed by `<name>`" badge
      plus Release (claimed by the signed-in moderator), or just the
      badge (claimed by someone else) — approve/reject/flag stay enabled
      regardless of claim state, since a claim is an optional ownership
      signal, never a review gate
- [x] SLA breach detection job (GitHub issue #488) — new
      `breach_notified_at` column (hand-authored migration, `migrate
      deploy`) plus `SlaBreachDetectionService` (`@Cron`, hourly,
      in-process — same D72 precedent as the reconciliation sweep, not a
      Kubernetes CronJob), scanning for unreviewed entries past
      `slaDeadline` not yet notified and publishing a new
      `moderation.queue.sla_breach.v1` event once per entry, regardless
      of claim state (`claimedById: null` for an unclaimed breach — no
      recipient, but still detected/observable)
- [x] `notification-service`: consume SLA breach events, email the
      moderator (GitHub issue #489) — extends the existing consumer
      (Phase 31) to also subscribe to `moderation.queue.sla_breach.v1`;
      recipient resolved via `claimedById` -> a new minimal `Moderator`
      mirror model (D75), not a decrypted candidate email; an
      unclaimed breach is logged and skipped (no recipient, D80)
- [x] Queue UI: surface SLA deadline and breach state (GitHub issue
      #490) — a `SlaBadge` per entry (`formatSlaStatus()` in
      `web/src/lib/format-sla-status.ts`, minutes/hours/days,
      red "Overdue by X" vs. neutral "Due in X"), computed at render
      time (no live-ticking clock — a moderator who leaves the page
      open sees a slightly stale label until the next re-render/action)
- [x] Docs: resolve D80 and update DATA_MODEL/ARCHITECTURE for Phase 36
      (GitHub issue #491) — new `### D80` entry (SLA-clock-start,
      manual-claim-only assignment and its unclaimed-breach
      consequence, email channel), new `moderators` table section in
      `docs/DATA_MODEL.md`, `docs/ARCHITECTURE.md` updated for
      `SlaBreachDetectionService`/the new event/`notification-service`'s
      new subscription
- [x] Engineering blog (last) (GitHub issue #492) — `wiki/blog/
      phase-36-moderator-queue-slas-assignment-notifications/`, one
      post per issue (#485-#491)

**Amendment (sketched 2026-07-29, from Phase 39's own brainstorm):**
also now a downstream consumer of Phase 39's flagged/ambiguous LLM
verdicts, once that phase exists — a new automatic ticket source
alongside today's manual-flag path. Doesn't resolve any of this
phase's own parked questions above, just adds a second thing capable
of creating a ticket. Out of scope for the issues filed above; revisit
once Phase 39 exists.

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
- [x] System-attributed auto-approve path: `AiModerationService` calls
      `ModerationService.approve()` for clean verdicts, attributed to a
      system actor, durably audited in a new dedicated table (never
      best-effort/swallowed the way D16/D17's search indexing is)
      (GitHub issue #440)
- [x] Config-driven kill switch (single global env var) forcing every
      verdict back to D66's original advisory-only behavior, no deploy
      needed (GitHub issue #441)
- [x] Reconciliation sweep: scheduled job re-triages or escalates any
      `pending` row past 24h with no verdict yet — closes the
      "lost/never-ran triage" gap without a transactional outbox
      (GitHub issue #442)
- [x] Engineering blog (last) (GitHub issue #443)

## Phase 40 — CI Infrastructure: Self-Hosted GitHub Actions Runner

Filed 2026-08-03, ahead of this repo's GitHub Actions minutes hitting a
billing gate. Runs on a free-tier VM instead of paying for hosted
minutes; deliberately keeps the repo private rather than trading to a
public repo for GitHub's unlimited free hosted-runner minutes, since a
self-hosted runner paired with a public repo lets any fork's PR execute
code on the runner host (D82). Milestone: "Phase 40 — CI
Infrastructure: Self-Hosted GitHub Actions Runner". Epic: GitHub issue
#499.

- [x] Decision record (D82): self-hosted runner, private-repo-only
      rationale (GitHub issue #500)
- [ ] Provision self-hosted-runner VM (Oracle Cloud Always Free ARM
      instance, hardened host) (GitHub issue #501)
- [ ] Install and register the GitHub Actions self-hosted runner agent
      (GitHub issue #502)
- [ ] Run the runner as a resilient systemd service; verify job/
      workspace isolation (GitHub issue #503)
- [ ] Migrate `.github/workflows/*.yml` from `ubuntu-latest` to
      `self-hosted` (GitHub issue #504)
- [ ] Runbook: self-hosted CI runner setup, recovery, and token
      rotation (GitHub issue #505)
- [ ] Engineering blog (last) (GitHub issue #506)

## Phase 41 — Moderator Queue Priority, Filters & Seed-Data Parity

Raised while auditing which backend features actually have frontend
consumption (2026-08-04): `GET /moderation/queue` sorts by `createdAt`
only and has no filters beyond `search`'s free-text `q`/`category`, even
though Phase 36 already added `slaDeadline`/`claimedById` to every entry.
The same conversation surfaced two bigger ideas for the moderator/admin
surface — an analytics dashboard, and a moderator ↔ candidate ↔ moderator
communication loop closing the D79 gap (flagged submissions currently get
no candidate-facing notification at all) — both scoped out to their own
future phases rather than folded in here, since neither is detailed
enough yet to plan properly. This phase is deliberately just the feed/
filter work plus the one thing blocking it from being testable: the
seed-data script never got extended for Phase 36 (no moderator/claim
simulation) or the full `ModerationFlagReason` enum (hardcodes
`manual_report` for every flagged entry), so the new filters would have
nothing realistic to show against on the dev instance.

Two decisions made during planning:
- **Priority basis**: derived from the existing `slaDeadline` (sort by
  urgency) rather than a new stored priority field — reuses Phase 36
  infra as-is.
- **Communication-loop mechanism** (for the future phase, noted here for
  continuity): reuse the existing candidate edit flow rather than a new
  message/thread model — editing a rating already resets it to `pending`
  and re-enqueues (`round-ratings.service.ts`), so the loop's mechanism
  already exists; that phase's actual gap is closing D79 (no notification
  sent on flag) and surfacing `flagReason` to the candidate, not new
  schema.

Milestone: "Phase 41 — Moderator Queue Priority, Filters & Seed-Data
Parity" (#39). Epic: GitHub issue #521.

- [x] Moderation queue: server-side filters + SLA-urgency sort (GitHub
      issue #522) — `GET /moderation/queue` gains `entityType`,
      `companyId`, `claimState` (mine/unclaimed/all, resolved via the
      authenticated caller same as `claim`/`release`), and `status`
      query params; sort changes from `createdAt: 'asc'` to
      `slaDeadline: 'asc'`. No schema migration. `companyId` is resolved
      to concrete `entityType`/`entityId` pairs (round rating/recruiter
      rating/overall review each joined up to their process's company;
      `company` entityType's own `entityId` already *is* the company id)
      since moderation_queue's entity reference is polymorphic, not an
      FK
- [x] Moderation UI: filter controls + urgency-ordered queue view (GitHub
      issue #523) — filter controls on `web/src/app/moderation/page.tsx`
      wired to the new query params; reuses the existing `SlaBadge`/
      `formatSlaStatus()` urgency cue from Phase 36 rather than a second
      indicator
- [x] seed-demo-data: simulate moderator claims and vary flagReason
      across the full enum (GitHub issue #524) — seeds a handful of
      `Moderator` rows, claims ~30% of generated pending entries via the
      real `ModerationService.claim()` path, and randomizes `flagReason`
      instead of hardcoding `manual_report`; `moderationVerdict`
      population stays dependent on `review-analyzer` actually running
      during the seed, explicitly out of scope to fake directly
- [x] Engineering blog (last) (GitHub issue #525) — one post per issue
      under `wiki/blog/phase-41-moderator-queue-priority-filters-seed-data-parity/`

## Phase 42 — Staff Role Hierarchy & Admin/Moderator Tooling

Raised 2026-08-11 from a direct request to build a real admin > moderator
> user role hierarchy plus admin/moderator tools, planned before any of it
was coded per this project's own planning-first convention. Grounded in an
audit of the actual current state: `admin-auth` and `ModerationController`/
`AdminRoundTypeFieldOptionsController` are all gated by one `Moderator`
row backed by a single shared credential (`ADMIN_USERNAME`/
`ADMIN_PASSWORD_HASH`, Phase 36 #485) — "admin" and "moderator" are the
same undifferentiated actor today, not two tiers. D53 already considered
and explicitly declined extracting a `moderator-service` ("no concrete
scaling/deployment trigger has fired") — this phase revisits that same
services-vs-monolith question for the new hierarchy and reaches the same
answer, for the same reason.

Kickoff brainstorm resolved 2026-08-11 (issue #585):

- **Role set**: `StaffRole` enum — `ADMIN` > `MODERATOR` > `STAFF`.
  `STAFF` (deliberately not `USER` — that name already means `Candidate`
  in this codebase) is a real, shipped tier, not a placeholder: read-only
  access to the moderation queue, search, round-type registry, and
  moderator/SLA analytics dashboards, with no claim/approve/reject/flag/
  write permissions. Concrete job: support/onboarding/spot-check access
  without moderation authority, and a foothold for Phase 41's
  parked candidate-communication-loop idea.
- **Authorization shape**: a permission-set model (`moderation:queue:
  approve`, `admin:staff:manage`, etc.), each role a superset of the one
  below, behind one `@RequirePermission()` decorator/`PermissionsGuard` —
  not three hardcoded flat role checks scattered per controller. Chosen
  so a future nuance (e.g. a moderator without PII visibility) composes
  from existing permissions instead of forcing a new role/rewrite.
- **Schema shape**: `role`/`isActive`/`createdById` added directly to the
  existing `moderators` table rather than a renamed/new accounts model —
  renaming would ripple into `notification-service`'s own minimal mirror
  model (D75) and every existing FK/comment referencing `Moderator` for
  no functional gain. Deactivate, never delete, same precedent
  `ModerationQueueEntry.claimedById` already set by never being cleared.
  New `staff_audit_log` table for every admin action (account created,
  role changed, deactivated/reactivated, password reset) — durable,
  never best-effort, same precedent as `AiAutoApprovalAudit` (D71).
- **Credential model**: retire the single shared credential for the
  general case. Exactly one root `ADMIN` stays imperatively seeded at
  boot (same secrets pattern, hard constraint #6); every other account is
  created through admin tools by an existing `ADMIN`, password shown
  once at creation (same UX `rotate-admin-credentials.sh` already uses),
  changed via self-service after. `rotate-admin-credentials.sh` narrows
  to root-admin break-glass recovery rather than being deleted.
- **Services**: stays inside `api/` as clean, extractable NestJS modules.
  Same "no concrete trigger yet" call D53 already made for
  `moderator-service` — splitting now would add cross-service auth
  verification, a duplicated Prisma client, and another Dockerfile/
  manifest/CI job for a feature that is fundamentally a role column and
  some guards. Revisit if a genuine trigger fires later — either a real
  independent-scaling/deployment need (D53's own bar), or a distinct
  security/network-isolation boundary a future admin capability might
  need (a different kind of trigger than D53 was addressing).

Milestone: "Phase 42 — Staff Role Hierarchy & Admin/Moderator Tooling".
Epic: GitHub issue #584.

- [x] Phase 42 kickoff: `StaffRole` hierarchy, permission-set model,
      credential-retirement plan — decision record (GitHub issue #585,
      written up as D99 in `docs/DECISIONS.md`)
- [x] Prisma migration: `StaffRole` enum, `role`/`isActive`/
      `createdById` on `moderators`, `staff_audit_log` table (GitHub
      issue #586)
- [x] Permission-set authorization: `RequirePermission` decorator,
      `PermissionsGuard`, role claim on the staff JWT (GitHub issue #587)
- [x] Migrate `ModerationController` and
      `AdminRoundTypeFieldOptionsController` to permission-based guards
      (GitHub issue #588)
- [x] Staff account management endpoints: create/list/update-role/
      deactivate/reactivate, self-service password change, audit
      logging (GitHub issue #589)
- [x] Retire shared admin credential for the general case; narrow
      `rotate-admin-credentials.sh` to root-admin break-glass recovery
      (GitHub issue #590)
- [x] Frontend: role-aware admin panel (nav/action gating by
      permission) + staff account management UI (GitHub issue #591)
- [x] seed-demo-data: seed `STAFF`/`MODERATOR`/`ADMIN` accounts with
      varied roles (GitHub issue #592)
- [x] Engineering blog (last) (GitHub issue #593) — one post per issue
      under `wiki/blog/phase-42-staff-role-hierarchy-admin-moderator-tooling/`
- [x] Post-launch fix: hide the root admin (`createdById: null`) from
      `/admin/staff` (never listed or actionable through the API — it's
      managed by `rotate-admin-credentials.sh` only) and reject
      deactivating/demoting the last remaining active non-root admin.
      Found live using #591's UI; filed as a follow-up sub-issue of this
      same epic rather than a separate phase (GitHub issue #607)

## Phase 43 — Design System Refresh & Theming

Requested 2026-08-12: the app reads as a working scaffold, not a
finished product — stock Tailwind `gray-*`/`indigo-600` with no token
layer, and "dark mode" is really just Tailwind's default `media`
strategy duplicated per component rather than something a visitor can
actually choose. Brainstormed as a Frontend SME/architect pass (design
brief artifact from the planning conversation covers the full
reasoning, token values, component gallery, and page mockups) before
any issue was filed, same "plan before implementing" discipline as
every other phase.

Direction: a "structured evaluation" visual identity — not a generic
SaaS reskin, and deliberately not a levels.fyi layout clone — built
around this product's own shape (per-round difficulty, three named
interviewer traits, shrinkage-adjusted aggregates that can legitimately
be "not enough data yet") rather than borrowing a comp-transparency
tool's table-first layout wholesale. IBM Plex Serif/Sans/Mono across
display/body/data roles, a teal accent, a reserved four-color status
vocabulary (pending/approved/rejected/flagged), and single-hue
magnitude charts — chart and status colors validated with the
`dataviz` skill's checker, not eyeballed. Scope: the shared token/theme
foundation plus the four screens carrying the most trust load
(landing/search, company profile, analytics dashboard, moderation
status vocabulary). The wizard (Phase 26) and moderation queue (Phases
36/41) keep their current information architecture — this phase only
carries the new token system through, not a restructure. Milestone:
"Phase 43 — Design System Refresh & Theming". Epic: GitHub issue #611.

- [x] Design tokens & Tailwind foundation — color/space/radius/
      elevation as CSS custom properties, `darkMode: 'class'` in
      `tailwind.config.ts`, slate-leaning neutral scale replacing bare
      `gray-*` (GitHub issue #612, D100)
- [x] Light / dark / system theme toggle — `getStoredThemePreference`/
      `applyThemePreference` in `src/lib/theme.ts`, FOUC-safe inline
      blocking script in `layout.tsx`'s head, `localStorage`
      persistence, three-way switch in `NavBar` (GitHub issue #613)
- [x] Icon system: adopt `lucide-react` (GitHub issue #614) — zero
      new transitive dependencies, confirmed via the lockfile diff
- [x] Accessible primitives: adopt Radix UI for Dialog/Tooltip;
      migrate `ConfirmationModal` and `HelpTooltip` onto them (GitHub
      issue #615) — Tabs/DropdownMenu not needed, no call site for
      either surfaced once the redesign issues actually landed
- [x] `NavBar` redesign — responsive/mobile menu (the current nav had
      no small-viewport handling at all), theme toggle, refined brand
      mark (GitHub issue #616)
- [x] Landing page redesign — hero search, trending-company card grid
      (`CompanyCard`); keeps Phase 33's search-first information
      architecture (GitHub issue #617) — score chips/stats strip
      dropped from scope: `Company`/`CompanySearchResult` don't carry
      aggregate scores or platform-wide counts today, and a bulk-scores
      endpoint is backend work outside this frontend-only phase
- [x] Company profile redesign — hero header (avatar, score ring),
      redesigned review cards with a round-type `Chip` (GitHub issue
      #618) — no tabbed layout: this page's real content is just
      "Overall experience" + "Reviews" (Round ratings/Recruiter
      experience live only on `/analytics`), so tabs for content the
      page doesn't fetch would have been fabricated structure
- [x] Analytics dashboard redesign — stat-tile row (`StatTile`) +
      single-hue magnitude bar chart (`DifficultyBar`, using the
      `--chart-seq-1..5` tokens #612 defined), replacing the `dl` grid
      of `ScoreDisplay` pairs (GitHub issue #619)
- [x] Status vocabulary rollout — `StatusPill`, applied to `/me`'s
      round/recruiter/overall-review statuses, the moderation queue's
      "Auto-flagged" notice, and `/admin/staff`'s Active/Deactivated
      state; found and fixed a real bug in the process — `pending` and
      `flagged` previously rendered as the *identical* amber text
      (GitHub issue #620)
- [x] Wizard visual pass — completion progress bar + rated/unrated
      icons in `StepNavigator`; Phase 26's free-jump navigation model
      unchanged (GitHub issue #621)
- [x] Accessibility & responsive audit across the phase (GitHub issue
      #622) — found and fixed two real bugs: a round-type label
      truncating on mobile, and `StatusPill`'s dark-mode "Rejected"
      text failing AA-normal contrast (3.62:1) against its real
      rendered background
- [x] Engineering blog (last) (GitHub issue #623) — one post per issue
      under `wiki/blog/phase-43-design-system-refresh-theming/`

## Phase 44 — Hetzner Cloud: Account Setup & Hardened VM Provisioning

Filed retroactively 2026-08-13, to give already-completed work a real
record rather than leave it undocumented. #501 (Phase 40, Oracle Cloud
Always Free A1.Flex) has been stuck on "out of host capacity" since
2026-08-04; a Hetzner Cloud account, Terraform
(`infra/terraform/hetzner/`), and one hardened pilot VM were stood up
as a parallel, low-cost path in the meantime — not a replacement for
#501 (its retry loop keeps running), and not a change to D11 (AWS
remains the real Phase 8 production target). See D101 for the full
reasoning: the AWS/OCI cost comparison that motivated looking beyond
Oracle, why Hetzner specifically, and the explicit boundary against
D11. This phase covers infrastructure provisioning only — what actually
runs on the VM is Phase 45's scope. Milestone: "Phase 44 — Hetzner
Cloud: Account Setup & Hardened VM Provisioning". Epic: GitHub issue
#641.

- [x] Decision record (D101): Hetzner Cloud as a parallel low-cost
      provisioning path — relationship to D11 and #501 (GitHub issue
      #651)
- [x] Provision Hetzner Cloud VM via Terraform (GitHub issue #639) —
      SSH key-only auth, no root login, dedicated non-root `deploy`
      user, unattended-upgrades, fail2ban, inbound restricted to SSH
      only via a Cloud Firewall; `HCLOUD_TOKEN` read from the
      environment, never committed
- [x] Run `terraform apply`; verify SSH hardening (GitHub issue #643)
      — corrected `cx32`/`ash` (invalid server type; Ashburn's
      Regular Performance tier at ~$41.99/mo) to `cx33`/`nbg1`
      (~$9.99/mo) before apply; confirmed key-only login, root login
      refused, password auth refused
- [x] Engineering blog (last) (GitHub issue #644)

## Phase 45 — App-Hosting Pilot on Hetzner

Filed 2026-08-13, same planning pass as Phase 44. Builds on Phase 44's
hardened VM: install k3s and deploy this repo's existing
`infra/k8s/base` manifests as a lean-launch pilot — a real, reachable
instance of the full stack (api/web/notification-service/
review-analyzer/Postgres/OpenSearch/Redpanda) at a fraction of managed-
cloud cost. Separate from D11's AWS production target, which this
doesn't change or supersede. Milestone: "Phase 45 — App-Hosting Pilot
on Hetzner". Epic: GitHub issue #642.

- [x] Install k3s on the Hetzner pilot VM (GitHub issue #645)
- [x] `overlays/hetzner-pilot` kustomize overlay for `infra/k8s/base`
      (GitHub issue #646) — real hostnames, real TLS, GHCR images, no
      Mailpit, no LocalStack
- [x] Secrets for the pilot environment — no LocalStack, real values,
      never committed (GitHub issue #647)
- [x] Real SMTP relay, replacing Mailpit — Mailpit is a local-only
      catcher (D29) that would silently swallow every email on a pilot
      meant to be actually reachable; scoped out of #647 into its own
      issue once that distinction surfaced (GitHub issue #655) — SMTP
      auth support (`MAIL_SMTP_USER`/`MAIL_SMTP_PASSWORD`) landed in both
      `api`/`notification-service`'s mail transporters, Brevo picked as
      the relay, `MAIL_FROM_ADDRESS` and the overlay wiring (#646) live
- [x] Deploy `overlays/hetzner-pilot`; verify full-stack health end to
      end (GitHub issue #648) — live and independently verified:
      `https://app.interviewinsights.fyi` and
      `https://api.interviewinsights.fyi/health` both return real `200`s
      from outside the cluster entirely, real trusted TLS. Two real bugs
      surfaced and fixed along the way: `HETZNER_VM_IP` missing from the
      CI checkout, and the `web` image failing to build under this
      runner's cross-arch QEMU emulation — see D109/D110/D111 (GitHub
      issue #761, its own fix: `web` now builds on a native GitHub-hosted
      runner instead of emulating)
- [x] Runbook: Hetzner pilot deploy, recovery, and teardown (GitHub
      issue #649) — `wiki/deployment-guide.md` section 12
- [x] Engineering blog (last) (GitHub issue #650) — one post per issue
      under `wiki/blog/phase-45-app-hosting-pilot-hetzner/`

**Note:** despite the lower phase number, several of this phase's
issues (#646/#655/#648) couldn't fully close until Phase 46 below
resolved its own blocking issues — Phase 46 was filed after gaps
surfaced during #647's own work, same "discovered after the original
planning pass" situation as #655. Same precedent as Phase 44/45's own
out-of-strict-order relationship (see Phase 44's intro). All resolved
as of 2026-08-19 — Phase 45 is fully done, blog included.

## Phase 46 — Hetzner Pilot: Reachability & Operational Hardening

Filed 2026-08-14, surfaced while working #647: getting `api`/`web`
actually reachable over the real internet — not just deployed inside
the cluster — needs a domain, an open firewall, TLS, a way for images
to reach a VM that isn't the CI runner's own machine, and a handful of
operational safeguards (backups, disk monitoring, access control) that
`dev`/`staging`/`prod` never needed because they're not real, reachable
environments. See D103 for why this is its own phase rather than more
issues folded into #642. Milestone: "Phase 46 — Hetzner Pilot:
Reachability & Operational Hardening". Epic: GitHub issue #657.

Split into two tracks, added 2026-08-14 during a TPM-style review of
Phases 45-51: **Track A** is the critical path to a reachable HTTPS
pilot (blocks #648); **Track B** is operational hardening that doesn't
block reachability, only (per each issue's own note) either "should
land before #648 creates real data" or "informs #649" (the runbook).
Track A/B is a reading aid, not a new epic split — both stay under
#657. Within Track A, #658/#659/#660 have no dependency on each other
and can run in parallel; #661/#662/#708 depend on the outcome of that
first group.

### Track A — critical path to reachability

- [x] Decide the pilot's public domain and create DNS records pointing
      at the Phase 44 VM's IP (GitHub issue #658) — `interviewinsights.fyi`
      via Cloudflare Registrar; `app.`/`api.` A records live and confirmed
      resolving to the pilot's IP from both 1.1.1.1 and 8.8.8.8
- [x] Open ports 80/443 in the Hetzner Cloud Firewall via Terraform
      (GitHub issue #659) — `infra/terraform/hetzner/main.tf`'s
      `hcloud_firewall.ssh_only` (Phase 44) currently allows only port
      22; blocks TLS issuance below and #648's reachability check
- [x] Container image delivery path to the pilot VM — registry
      push/pull, since `cd.yml`'s `kind load image-archive` only works
      because CD and the target cluster are the same machine today
      (GitHub issue #660) — blocks #648. Also documents the new GHCR
      PAT this introduces in `docs/SECRETS.md`'s inventory table (used
      both by the runner for `docker push` and as the pilot's
      `imagePullSecret`) — no secret this project provisions should be
      missing from that inventory, per CLAUDE.md's hard constraint #6.
      Proven live: pushed a test image to GHCR, `ghcr-pull-secret`
      created on the pilot, a real pod pulled it successfully
- [x] Install `ingress-nginx` on the k3s cluster, disabling k3s's
      default Traefik (GitHub issue #661) — depends on #645 (k3s
      installed); blocks #646/#648, since `infra/k8s/base/07-ingress.yaml`
      hardcodes `ingressClassName: nginx`. ingress-nginx was archived by
      its maintainers 2026-03-24 (no further releases/security fixes) —
      pinned to its final release (Helm chart `4.15.1`, `appVersion`
      `1.15.1`) for the pilot anyway rather than diverging its ingress
      tech from every other environment; see D108 for the full tradeoff
      and the separate Gateway API evaluation follow-up it filed
- [x] TLS for the pilot via cert-manager + Let's Encrypt, and flipping
      `COOKIE_SECURE` to `"true"` in the pilot overlay once real HTTPS
      is live (GitHub issue #662) — staging cert proved the HTTP-01 flow
      first, then the real production cert issued and independently
      verified (`curl` from outside the cluster, real trusted handshake,
      no `-k`); reissued a second time after the D109/D110 VM-recreation
      incident, same live-verified result both times
- [x] Decide and document the deploy pipeline to the pilot — manual via
      the runbook, or a future CD job (GitHub issue #665) — resolved
      2026-08-14: CD job, via #708
- [x] Build `cd-hetzner.yml` — push images to GHCR, deploy
      `overlays/hetzner-pilot` to the Hetzner k3s cluster, **and
      provision every Hetzner-pilot secret itself** from GitHub Actions
      repo secrets (GitHub issue #708) — a second CD workflow alongside
      the existing `cd.yml` (kind/local target), not a replacement.
      See D105 — supersedes D102's manual/out-of-band secret sourcing
      for this environment now that a CD workflow actually reaches it.
      `web`'s image build moved to a GitHub-hosted `ubuntu-latest` job
      (D111, GitHub issue #761) — genuinely native x86_64, sidesteps the
      QEMU/SWC segfault the self-hosted runner's emulation hit; the other
      three images still build on the self-hosted runner under emulation,
      which works fine for them — **superseded 2026-08-20, see Phase 20's
      #770 bullet:** those three also moved off the self-hosted runner,
      and so did `deploy` itself; `cd-hetzner.yml` no longer touches the
      Mac at all

### Track B — operational hardening (non-blocking)

- [x] Backup strategy for the pilot's Postgres data, with a proven
      restore path (GitHub issue #663) — the real restore-path proof
      ran live against the pilot's actual Postgres once #648 deployed
      it: a marker row survived a full backup -> delete -> restore
      round-trip. Got accidentally auto-closed once already by a PR
      body's own negated "closes #663" phrasing (see
      `wiki/github-project-setup.md`'s closing-keyword gotchas) before
      the real proof had run — reopened, then closed for real once it
      did
- [x] Guardrail against running `seed-demo-data`/`seed-demo-data-undo`
      against the pilot (GitHub issue #664) — should land before #648
      first runs with real intent
- [x] k3s upgrade/patch cadence for the pilot VM (GitHub issue #666) —
      informs #649
- [x] Disk-usage monitoring for the pilot VM, mirroring the CI runner's
      D85/D86/D87 lesson (GitHub issue #667)
- [x] kubeconfig and access control for the pilot cluster — who can
      `kubectl` against it, from where (GitHub issue #668) — informs
      #649
- [x] Engineering blog (last) (GitHub issue #669) — one post per issue
      under `wiki/blog/phase-46-hetzner-pilot-reachability-operational-hardening/`

## Phase 47 — Moderation Queue Correctness Hardening

Filed 2026-08-14, surfaced by an end-to-end audit of this project's
notification/communication chains: `ModerationService.review()` and
`claim()`/`release()` (`api/src/moderation/moderation.service.ts`) both
read a queue entry's state, then write it back later with no condition
guarding that the state hasn't changed in between — two moderators (or a
moderator racing the AI auto-approval path) acting on the same entry
within that window can both commit, producing duplicate `status_changed`
events and, in the worst case, contradictory approved/rejected emails to
the same candidate. See D104. Milestone: "Phase 47 — Moderation Queue
Correctness Hardening". Epic: GitHub issue #673.

Ordered by dependency — each issue only depends on ones above it in this
list unless noted otherwise:

- [x] Fix TOCTOU race in `ModerationService.review()` via an atomic
      conditional update (GitHub issue #674)
- [x] Fix the same race shape in `claim()`/`release()` (GitHub issue
      #675) — independent of #674, same fix pattern
- [x] Regression tests for concurrent moderation actions (GitHub issue
      #676) — depends on #674, #675
- [x] Engineering blog (last) (GitHub issue #677)

## Phase 48 — Candidate Password Authentication

Filed 2026-08-14, from the same audit: candidates were the only actor in
this system still on magic-link-only auth, while `admin-auth`
(`api/src/admin-auth/`) already proves a password + bcrypt +
login-throttle pattern in production for staff accounts. This phase
brings candidate-auth to parity with that existing pattern and retires
magic-link as the primary login path — see D104 for why. Milestone:
"Phase 48 — Candidate Password Authentication". Epic: GitHub issue #678.

Ordered by dependency:

- [x] `Candidate` schema migration — passwordHash/passwordSetAt/
      tokenVersion (GitHub issue #679) — blocks everything else in this
      phase
- [x] `POST /candidates/register` + verification email (GitHub issue
      #680) — depends on #679. Shipped as `POST /auth/register` (not
      literally under `/candidates`) — matches every other candidate
      session endpoint's existing `CandidateAuthController`/`/auth`
      prefix (`/auth/request-link`, `/auth/verify`, `/auth/login`), same
      as admin-auth's own `/auth/admin/*` convention
- [x] `POST /candidates/login` + `CandidateLoginThrottleGuard` (GitHub
      issue #681) — depends on #679. Shipped as `POST /auth/login`, same
      `/auth` prefix note as #680
- [x] `PasswordResetToken` table + request/confirm endpoints (GitHub
      issue #682) — depends on #679
- [x] Retire magic-link as primary login; update frontend (GitHub issue
      #683) — depends on #680, #681, #682
- [x] Engineering blog (last) (GitHub issue #684)

## Phase 49 — Resubmission Loop & Rejection Feedback

Filed 2026-08-14, from the same audit: candidates can edit a
rejected/flagged rating or review indefinitely (throttled only to
5/hour, no lifetime cap — `api/src/common/edit-throttle.service.ts`),
and a confirmed bug in `NotificationLog`'s idempotency key
(`services/notification-service/prisma/schema.prisma`) means a candidate
is never notified of any review decision after the first one on a given
entity, since the key doesn't account for the fresh
`ModerationQueueEntry` each edit creates. This phase also activates D99's
parked "candidate-communication-loop" idea. See D104. Milestone: "Phase
49 — Resubmission Loop & Rejection Feedback". Epic: GitHub issue #685.

Ordered by dependency:

- [x] Add `moderationQueueEntryId` to `*.status_changed.v1` event schemas
      (GitHub issue #686) — blocks #687
- [x] Fix `NotificationLog` idempotency key to include
      `moderationQueueEntryId` (GitHub issue #687) — depends on #686,
      the confirmed-bug fix
- [x] `notification-service` reconciliation sweep for missed/failed
      notification deliveries (GitHub issue #711) — depends on #687
      (needs the corrected idempotency key to tell "already sent" from
      "missing"); mirrors `review-analyzer`'s existing
      `ReconciliationSweepService` rather than a literal Kafka
      dead-letter topic. Surfaced by Phase 8g's never-executed planning
      pass (D106) — Phase 8 itself stays deferred for the real AWS
      migration, this fix landed here instead since it's squarely
      inside this phase's own notification-reliability scope
- [x] Add `rejectionReasonCategory` + `reviewNote` to
      `ModerationActionDto` (GitHub issue #688) — candidate-facing
      surfacing (rejection email, `/me`) and required-when-rejected
      validation never shipped in this pass; tracked as a follow-up,
      GitHub issue #729
- [x] Lifetime resubmission cap + escalation to senior-moderator/admin
      queue (GitHub issue #689)
- [x] New `closed`/`permanently_rejected` terminal status (GitHub issue
      #690) — depends on #689's escalation permission
- [x] Surface prior-submission history in moderator queue UI (GitHub
      issue #691) — depends on #688 for the reason text
- [x] Publish resubmission-ack event on `reenqueue()` (GitHub issue #692)
      — depends on #687's fixed idempotency key
- [x] Move `EditThrottleService` off in-memory storage before horizontal
      scaling (GitHub issue #693)
- [x] Engineering blog (last) (GitHub issue #694)

## Phase 50 — Company Creation Request Lifecycle

Filed 2026-08-14, from the same audit: a rejected company creation
request permanently occupies its slug (no recovery path —
`CompaniesService.create()`'s own comment flags this as "unresolved")
and generates zero notification on submit/approve/reject, since
`ModerationService.publishCreatedEvent`/`publishStatusChangedEvent` both
explicitly no-op for `entityType: 'company'`. Scoped to the pragmatic
partial-unique-index fix rather than a full CompanyCreationRequest/
Company entity split — see D104 for why. Milestone: "Phase 50 — Company
Creation Request Lifecycle". Epic: GitHub issue #695.

Ordered by dependency:

- [x] `candidateId` FK on `Company` + partial unique index on `slug`
      scoped to `pending`/`approved` (GitHub issue #696) — blocks #697,
      #698
- [x] `PATCH` edit endpoint for a candidate's own rejected/pending
      company request (GitHub issue #697) — depends on #696
- [x] `company.created.v1`/`company.status_changed.v1` events +
      notification-service consumption (GitHub issue #698) — depends on
      #696
- [x] Engineering blog (last) (GitHub issue #699)

## Phase 51 — Staff/Admin/Moderator Notification Platform

Filed 2026-08-14, from the same audit: `StaffAccountsService`'s five
mutating methods (create/updateRole/deactivate/reactivate/resetPassword)
end in only a Postgres write plus `StaffAuditLogService.record()` — no
email, no domain event, no in-app signal reaches the affected staff
member or any other admin. Separately, `SlaBreachDetectionService`'s
hourly sweep notifies the claiming moderator (Phase 36, #489) but an
*unclaimed* breach notifies no one. Sequenced last so it reuses Phase
49's event/idempotency conventions rather than building a third parallel
notification scheme. See D104. Milestone: "Phase 51 — Staff/Admin/
Moderator Notification Platform". Epic: GitHub issue #700.

Ordered by dependency:

- [x] `staff.account.*` event schemas (GitHub issue #701) — blocks #702
- [x] Publish `staff.*` events from `StaffAccountsService` (GitHub issue
      #702) — depends on #701
- [x] `StaffNotificationRecipientsService` (role -> active email list)
      (GitHub issue #703) — blocks #704, #705
- [x] Tiered SLA escalation — broadcast to moderators, escalate
      unclaimed breaches to admins (GitHub issue #704) — depends on #703
- [x] notification-service consumer extension + templates for `staff.*`
      events (GitHub issue #705) — depends on #702, #703
- [x] Engineering blog (last) (GitHub issue #706)

## Phase 52 — Security & Access-Control Hardening

Filed 2026-08-20, surfaced by a six-domain pre-launch audit (security,
data integrity, business logic, infrastructure, frontend, code quality)
commissioned ahead of the lean launch — six parallel specialist passes
against the whole stack. The security pass found two endpoints
(`rounds`, `recruiter-interactions`) with no auth guard and no ownership
check at all, unlike every sibling write endpoint — `rounds` isn't even
covered by `moderation_queue`, so unauthenticated free text could reach
a public process page with zero review. It also found the IP-based
throttle guards effectively collapse to one shared bucket behind
ingress-nginx (no `trust proxy`), and no security headers (`helmet`)
anywhere. All six of CLAUDE.md's hard constraints were separately
verified as genuinely enforced in code, not just documented. Milestone:
"Phase 52 — Security & Access-Control Hardening". Epic: GitHub issue
#774.

Ordered by dependency — each issue only depends on ones above it in this
list unless noted otherwise:

- [x] No auth guard on round creation lets anyone inject unmoderated
      content (GitHub issue #775)
- [x] No auth guard on recruiter-interaction creation, same gap as round
      creation (GitHub issue #776) — same fix pattern as #775
- [x] IP-based throttles collapse to one shared bucket behind ingress,
      missing trust proxy (GitHub issue #777)
- [x] Add helmet security headers to api, notification-service, and
      review-analyzer (GitHub issue #778)
- [x] Prisma exception filter can leak internal detail on unmapped error
      codes (GitHub issue #779)
- [x] CORS/cookie config has no boot-time assertion for
      COOKIE_SECURE/CORS_ORIGIN (GitHub issue #780)
- [x] Raw SQL identifier interpolation in fraud-checks is an
      injection-shaped pattern (GitHub issue #781)
- [x] verdict-consumer doesn't schema-validate Kafka event payloads
      (GitHub issue #782)
- [x] Staff email has no documented PII-handling rationale, unlike
      candidate email (GitHub issue #783)
- [x] Local dev EMAIL_ENCRYPTION_KEY is a low-entropy hand-typed
      placeholder (GitHub issue #784)
- [ ] Engineering blog (last) (GitHub issue #785)

## Phase 53 — Data Integrity, Consistency & Documentation Reconciliation

Filed 2026-08-20, from the same audit: the data-integrity pass found
that the three analytics materialized views
(`company_round_type_aggregates`, `company_recruiter_aggregates`,
`company_overall_aggregates`) are never refreshed in production — the
only `REFRESH MATERIALIZED VIEW` call anywhere in the repo is inside a
manual dev/demo seeding script, so the analytics dashboard has been
frozen at last manual seed since the app went live. It also found GDPR
erasure (`MeService.eraseMe()`) FK-violates for any candidate who ever
reset a password or edited a submission, and that `CompaniesService.
create()` is the one write path not wrapped in the same transaction as
its moderation enqueue. Separately, three independent audit passes
(data integrity, business logic, frontend) each re-derived on their own
that `docs/ARCHITECTURE.md`'s "Known gaps" section is stale — it still
claims `RecruiterInteraction`/`RecruiterRating`/`OverallReview` have no
write path, when all three have been fully built since Phase 14. This
phase folds that reconciliation in alongside the data-integrity fixes
rather than spinning up a seventh epic for four documentation-only
issues. Milestone: "Phase 53 — Data Integrity, Consistency &
Documentation Reconciliation". Epic: GitHub issue #786.

Ordered by dependency:

- [x] Analytics materialized views are never refreshed in production
      (GitHub issue #787)
- [x] GDPR erasure (eraseMe) FK-violates for candidates with
      password-reset or edit-throttle rows (GitHub issue #788)
- [x] Company creation isn't transactional with its moderation enqueue
      (GitHub issue #789)
- [x] Fraud-check rate limit is a TOCTOU race (GitHub issue #790) —
      deliberately deferred, not fixed; documented in code + D-log why
- [x] docs/ARCHITECTURE.md's recruiter/overall-review "zero write path"
      claim is stale (GitHub issue #791)
- [x] docs/DATA_MODEL.md lists GDPR erasure as an open decision though
      it's implemented (GitHub issue #792) — update once #788 lands
- [x] docs/DATA_MODEL.md's moderation_queue.entity_type list is missing
      'company' (GitHub issue #793)
- [x] docs/DATA_MODEL.md's round-type registry table is missing
      tech_screening (GitHub issue #794)
- [ ] Engineering blog (last) (GitHub issue #795)

## Phase 54 — Business-Process Closed-Loop Fixes

Filed 2026-08-20, from the same audit: the business-logic pass traced
every major process (submission, moderation, company creation, staff
lifecycle, resubmission, verification, fraud flagging, GDPR erasure,
bulk submission) end to end through actual code, looking for dead ends.
Most are genuinely closed loops. The exceptions: SLA breach/warning
notifications are one-shot with no "resolved" signal once a breached
item is finally handled, `candidates.verification_status`'s
`document_verified` value is schema-ready but structurally unreachable
(no document-upload flow exists anywhere), and `staff_audit_log` is
written on every staff mutation but never surfaced in any UI or read
endpoint. A fourth finding from this pass — rejected candidates never
learn why — was already filed as issue #729 (under Phase 49's epic)
before this audit ran; it's related to this phase's scope but stays
under its original epic/milestone rather than being re-parented, per
GitHub's one-parent-per-sub-issue limit. Milestone: "Phase 54 —
Business-Process Closed-Loop Fixes". Epic: GitHub issue #796.

Ordered by dependency:

- [x] SLA breach/warning notifications never signal resolution (GitHub
      issue #797)
- [x] candidates.verification_status.document_verified is a dead enum
      value (GitHub issue #798)
- [x] staff_audit_log is written but never surfaced in any UI or read
      endpoint (GitHub issue #799)
- [ ] Engineering blog (last) (GitHub issue #800) — also covers #729
      once it lands, since it's the fourth finding from this same audit
      pass
- Related, tracked separately: rejected candidates are never told why
  (GitHub issue #729, Phase 49's epic #685)

## Phase 55 — Infrastructure, CI/CD & Secrets Hardening

Filed 2026-08-20, from the same audit: the infra pass found that three
of the four Dockerfiles (`web`, `notification-service`,
`review-analyzer`) have no `.dockerignore` — the exact bug issue #450
already fixed for `api/`, never applied to the siblings — so a real
local `.env` in the build context can get baked straight into a pushed
GHCR image layer. It also found `.env.example` files and both LocalStack
seed scripts ship a real, working 32-byte AES-256 key for
`EMAIL_ENCRYPTION_KEY`, a literal violation of CLAUDE.md hard constraint
#6's "never a real or plausible-looking value," plus missing k8s
`securityContext`/non-root containers and an unverified Postgres
restore path (#663). Everything else checked (firewall, TLS, CI-runner
fork-PR exposure, network exposure) came back clean. Milestone: "Phase
55 — Infrastructure, CI/CD & Secrets Hardening". Epic: GitHub issue
#801.

Ordered by dependency:

- [ ] Add .dockerignore to web/, notification-service/, and
      review-analyzer/ Dockerfiles (GitHub issue #802)
- [ ] .env.example and LocalStack seed scripts ship a real, working
      encryption key (GitHub issue #803)
- [ ] Add permissions: block to all GitHub Actions workflows (GitHub
      issue #804)
- [ ] Containers run as root everywhere — no non-root USER or
      securityContext (GitHub issue #805)
- [ ] Postgres backups have no off-VM copy and restore is unverified
      (GitHub issue #806) — closes out #663's outstanding restore-path
      proof
- [ ] Pin the LocalStack image off :latest (GitHub issue #807)
- [ ] Pin third-party GitHub Actions to commit SHAs on
      credential-bearing workflows (GitHub issue #808)
- [ ] GHCR PAT is reused for both push and pull-secret roles (GitHub
      issue #809)
- [ ] Engineering blog (last) (GitHub issue #810)

## Phase 56 — Frontend & UX Hardening

Filed 2026-08-20, from the same audit: the frontend pass confirmed a
strong baseline (httpOnly session cookies, no exploitable
`dangerouslySetInnerHTML`, client-side authorization gates genuinely
backed by server-side `PermissionsGuard` checks) but found the round
title/description free-text fields carry no "don't include real names"
warning — unlike the recruiter-identifier field, which explicitly warns
against it — a real gap against CLAUDE.md hard constraint #1 given
those fields aren't even moderation-gated (see Phase 52's #775). It also
found no type-level guard against a future interviewer-identity leak
into shared frontend types, plus a handful of smaller validation and
error-handling edges. Milestone: "Phase 56 — Frontend & UX Hardening".
Epic: GitHub issue #811.

Ordered by dependency:

- [ ] Round title/description fields have no "don't include real names"
      warning (GitHub issue #812)
- [ ] No type-level guard against a future interviewer-name leak in
      frontend types (GitHub issue #813)
- [ ] Round-type-specific fields have no required-field enforcement
      client-side (GitHub issue #814)
- [ ] Confirm COOKIE_SECURE=true is set now that Hetzner TLS is live
      (GitHub issue #815)
- [ ] Confirm NEXT_PUBLIC_API_URL is a real env var at Hetzner build
      time (GitHub issue #816)
- [ ] Failed round-type field-options fetch silently drops fields
      instead of blocking the wizard (GitHub issue #817)
- [ ] Document that rating-input min/max attributes are cosmetic, not
      enforcement (GitHub issue #818)
- [ ] Engineering blog (last) (GitHub issue #819)

## Phase 57 — Code Quality & Performance Hardening

Filed 2026-08-20, from the same audit: the code-quality pass found the
codebase's baseline unusually high for how quickly it was built (strong
test coverage, no dead code, no N+1 query patterns found anywhere in
scope) — but found all three Kafka consumers
(`verdict-consumer`, `notification-consumer`, `analysis-consumer`) catch
processing errors and log "will be retried on redelivery" without ever
rethrowing or disabling kafkajs's default autocommit, so a transient
failure is silently and permanently dropped, not actually retried. It
also found `GET /companies` has no pagination (the sibling `findTop()`
was already fixed for the same reason after a live complaint, #415) and
several smaller pagination/error-message/timeout gaps. Milestone: "Phase
57 — Code Quality & Performance Hardening". Epic: GitHub issue #820.

Ordered by dependency:

- [ ] Kafka consumers silently drop messages on transient failure
      despite "retried on redelivery" comments (GitHub issue #821)
- [ ] GET /companies (findAll) has no pagination (GitHub issue #822)
- [ ] GET /moderation/queue has no pagination (GitHub issue #823)
- [ ] findApprovedReviews loads all rows then paginates in application
      memory (GitHub issue #824)
- [ ] Company search silently truncates to 10 results with no size/from
      control (GitHub issue #825)
- [ ] Unique-constraint errors leak raw column/constraint names to the
      client (GitHub issue #826)
- [ ] AI-triage transient failures are indistinguishable from "not
      configured" (GitHub issue #827) — pairs with #821's retry fix
- [ ] PATCH /companies/:id requires the full payload instead of true
      partial update (GitHub issue #828)
- [ ] Bulk submission transaction has no explicit timeout override
      (GitHub issue #829)
- [ ] IP throttle state is in-memory and single-instance only (GitHub
      issue #830)
- [ ] MailService and PrismaService have no dedicated unit tests
      (GitHub issue #831)
- [ ] Engineering blog (last) (GitHub issue #832)
