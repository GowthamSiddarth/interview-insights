# Architecture

*This doc describes what's actually built and running as of Phase 12,
not the Phase 1 target state. Where the original plan changed, that's
called out explicitly rather than silently rewritten — see
`docs/DECISIONS.md` for the reasoning behind each change.*

## System overview (current)

```mermaid
flowchart TD
    subgraph client["Client"]
        WEB["Next.js web\n(wizard, search, analytics dashboard)"]
    end

    subgraph apipod["api (NestJS, one Deployment)"]
        API["API layer\n(validation, DTOs, CORS)"]
        MOD["ModerationService\n(in-process, same DB transaction)"]
        FRAUD["FraudChecksService\n(rate-limit + duplicate-text flags)"]
        SEARCHSVC["CompanySearchService /\nreview indexing"]
        SECRETS["Secrets bootstrap\n(runs before NestFactory.create)"]
        PUB["DomainEventPublisher\n(best-effort, after commit)"]
        SLABREACH["SlaBreachDetectionService\n(@Cron, hourly, in-process —\nsame D72 precedent as the\nreconciliation sweep, #488)"]
    end

    subgraph notifpod["notification-service (NestJS, own Deployment, Phase 31)"]
        CONSUMER["NotificationConsumerService\n(Redpanda consumer group)"]
        NOTIFMAIL["MailService\n(own nodemailer copy, D73)"]
        NOTIFSECRETS["Secrets bootstrap\n(own copy, runs before\nNestFactory.create, D73)"]
    end

    subgraph analyzerpod["review-analyzer (NestJS, own Deployment, Phase 32)"]
        ANALYZER["AnalysisConsumerService\n(own Redpanda consumer group,\n#339 — logs receipt only,\nLLM triage lands in #340)"]
    end

    PG[("PostgreSQL\nrounds, ratings, candidates,\nmoderators (#485), materialized\nviews, notification_log")]
    OS[("OpenSearch\ncompanies + reviews index")]
    LS[("LocalStack\nSecrets Manager + IAM\n(dev overlay, unconditional, D76)")]
    RP[("Redpanda\nmoderation created/status-changed/\nsla_breach events")]
    MAILPIT[("Mailpit\nlocal SMTP catcher")]

    WEB -->|REST, CORS| API
    API --> PG
    API --> MOD
    MOD --> FRAUD
    MOD -->|on approve| SEARCHSVC
    SEARCHSVC --> OS
    API -->|full-text + facets| OS
    SECRETS -.->|fetches DATABASE_URL,\nEMAIL_HASH_SECRET,\nEMAIL_ENCRYPTION_KEY,\nCANDIDATE_JWT_SECRET at boot,\nown IAM role, D76| LS
    SECRETS -.-> API
    NOTIFSECRETS -.->|fetches DATABASE_URL,\nEMAIL_ENCRYPTION_KEY at boot,\nown IAM role, D76| LS
    NOTIFSECRETS -.-> CONSUMER
    MOD -->|publish, best-effort| PUB
    PUB -->|moderation created events\n#332| RP
    SLABREACH -->|scans moderation_queue for\nunreviewed + past-deadline,\nnot yet notified| PG
    SLABREACH -->|publish sla_breach.v1,\nonce per entry, #488| PUB
    RP -->|subscribe, consumer group\nnotification-service| CONSUMER
    CONSUMER -->|decrypt emailEncrypted\nby candidateId, D74| PG
    CONSUMER -->|resolve claimedById ->\nModerator.email, own mirror\nmodel D75, #489| PG
    CONSUMER -->|idempotency check/record,\nnotification_log, D75| PG
    CONSUMER --> NOTIFMAIL
    NOTIFMAIL -->|your submission is\npending review, #335| MAILPIT
    NOTIFMAIL -->|SLA breach —\nclaiming moderator only, #489| MAILPIT
    RP -->|subscribe, own consumer group\nreview-analyzer, #339| ANALYZER

    PG -->|REFRESH MATERIALIZED VIEW| ANALYTICS["AnalyticsService\n+ shrinkage scoring"]
    ANALYTICS --> WEB
```

```mermaid
flowchart LR
    DEV["git push to main"] --> GH["GitHub Actions\n(cd.yml, queued)"]
    GH -->|picked up when\n./run.sh is started| RUNNER["Self-hosted runner\n(on-demand, this laptop)"]
    RUNNER -->|build + kind load| IMAGES["api:k8s / web:k8s /\nnotification-service:k8s /\nreview-analyzer:k8s images"]
    RUNNER -->|kubectl apply -k| OVERLAY["overlays/dev"]
    OVERLAY --> CLUSTER["kind cluster\n(interview-insights namespace)"]
    RUNNER -->|reseed| LS2[("LocalStack")]
    K9S["k9s / kubectl top"] -.->|monitor| CLUSTER
```

Redis and ClickHouse were never built. Kafka/Redpanda eventually was
(Phase 30, later than the original plan assumed) — see "What changed
from the original plan" below.

## Component inventory (what's actually running, and why)

| Layer | Technology | Status |
|---|---|---|
| Frontend | Next.js + Tailwind (`web/`) | Wizard, search, analytics dashboard — all live |
| API | NestJS (`api/`) | REST, DTO validation, CORS, Prisma ORM |
| Primary store | PostgreSQL | All entities + 3 materialized views (Phase 4) |
| Moderation | In-process NestJS module (D12) | Only `RoundRating` has a write path (see gaps below) |
| Fraud checks | In-process, same module family | Rate-limit (3/24h) + duplicate-text flag, never blocks writes (D13) |
| Search | OpenSearch | Company + review indexes, best-effort sync writes (D16/D17) |
| Event bus | Redpanda | Broker deployed (Phase 30, D53); `ModerationService` publishes all 6 create/status-change events (#332), plus `SlaBreachDetectionService`'s `moderation.queue.sla_breach.v1` (Phase 36, #488) — see `docs/EVENTS.md` |
| `notification-service` (`services/notification-service/`) | NestJS, own Deployment, own minimal Prisma client (D75) | First standalone microservice (Phase 31, D53/D73, GitHub issue #334). Consumes all three `moderation.*.created.v1` topics ("your submission is pending review", #335), all three `moderation.*.status_changed.v1` topics (approved/rejected, `flagged` is a no-op, #336), and `moderation.queue.sla_breach.v1` (emails the claiming moderator via a new minimal `Moderator` mirror model, D75; no recipient — logged and skipped — if unclaimed, Phase 36 D80, #489), idempotently |
| `review-analyzer` (`services/review-analyzer/`) | NestJS, own Deployment, no DB/secrets yet | Second standalone microservice (Phase 32, D53, GitHub issue #339). Own consumer group subscribing to all three `moderation.*.created.v1` topics — logs receipt only; porting Phase 19 (#163)'s LLM triage and publishing `moderation.<type>.verdict_computed.v1` (D81) lands in #340 |
| Secrets/IAM | LocalStack (`dev` overlay, unconditional) | Default CD target as of Phase 12 issue #99 (D23); folded into `dev` itself, no separate `dev-localstack` variant, by GitHub issue #466 (D76). Full secret-by-secret inventory: `docs/SECRETS.md` |
| Orchestration | Kubernetes via `kind` | `infra/k8s/base` + `overlays/{dev,staging,prod}` |
| Ingress | `ingress-nginx` (Helm) | Host-based routing, `app.`/`api.interview-insights.local` |
| Cluster monitoring | `metrics-server` (Helm) + `k9s` | Phase 12 issue #90 |
| CI | GitHub Actions, GitHub-hosted runners | Lint/build/test on every PR |
| CD | GitHub Actions, self-hosted on-demand runner | Auto-triggered on push to `main`, executed only when `./run.sh` is started (Phase 12) |
| `workers/` | Placeholder | No logic — moderation stayed in-process (D12), never needed a separate consumer |
| `infra/terraform/` | Placeholder | Empty until a real cloud account exists (Phase 8+) |

## Why this shape

- **Postgres as primary store, not a document DB.** The domain is
  relational by nature — rounds belong to processes, ratings belong to
  rounds, aggregates roll up hierarchically. JSONB columns (`type_metadata`)
  absorb the genuinely flexible parts without forcing the whole schema
  into a document model.
- **Materialized views, and so far that's still enough (D9).** Three
  materialized views (`company_round_type_aggregates`,
  `company_recruiter_aggregates`, `company_overall_aggregates`) power the
  analytics dashboard. ClickHouse was the original Plan B if these ever
  strained under load — that point has never been reached, so it was
  never built. Not deferred vaguely; there's a concrete "revisit when
  views measurably strain" trigger and it hasn't fired.
- **Moderation runs in-process, not as a Kafka consumer (D12, revisited
  by D53).** The original plan had a separate event-bus-driven moderation
  worker. What actually shipped: `RoundRatingsService.create()` inserts a
  `moderation_queue` row in the *same DB transaction* as the rating —
  simpler, transactionally safe, and there's been no async load yet to
  justify decoupling it. Redpanda now exists (Phase 30) for
  distributed-systems practice, not because this reasoning changed — it's
  additive, best-effort plumbing for new downstream consumers
  (notification-service, review-analyzer), not a replacement for the
  synchronous write path. `workers/` stays an empty placeholder for the
  same reason it always has: no consumer runs from inside the monolith.
- **No Redis.** The original plan included Redis for hot aggregates and
  sessions. Neither materialized, so it was never added — same
  "don't build infrastructure nothing is asking for yet" instinct as D9.
- **Search is separate from the primary store.** Postgres full-text
  search doesn't scale well to the faceted search a company/review
  browsing experience needs (role, round type, date range) — OpenSearch
  is purpose-built for that, and indexing is best-effort/derived (D16):
  Postgres stays the source of truth, OpenSearch can be rebuilt from it.
- **Helm for third-party infra, Kustomize for our own (D19).** `ingress-nginx`
  and `metrics-server` are Helm-installed — they're maintained upstream
  and distributed as charts specifically for `helm upgrade`/`rollback` to
  track. `api`/`web`/`postgres`/`opensearch` stay Kustomize-managed
  (`infra/k8s/base` + environment overlays) — 2-4 services isn't
  "genuinely repetitive" enough to justify Helm for our own manifests yet.
- **LocalStack backs local secrets/IAM by default, not real AWS (D20/D22/D23).**
  `api` assumes an IAM role via STS and fetches `DATABASE_URL`/
  `EMAIL_HASH_SECRET` from LocalStack Secrets Manager at boot — genuinely
  exercised on every local CD run, not just proven once. This is
  local-only practice for Phase 8b/8d, explicitly not a production
  secrets solution: LocalStack's free tier doesn't evaluate IAM policies
  for real and doesn't emulate EKS.
- **CD reconciles a real automatic trigger with a deliberately
  session-scoped runner (Phase 12).** `cd.yml` triggers on every push to
  `main` that touches `api/**`/`web/**`/`services/notification-service/**`/
  `services/review-analyzer/**`/`infra/k8s/**` — a genuine `on: push`, not
  `workflow_dispatch`. But the
  runner that executes it is
  on-demand, not a persistent service: nothing repo-triggered runs on
  this machine unless a session explicitly starts `./run.sh` first.

## What changed from the original plan

The Phase 1 version of this doc described a target state that included
Kafka/Redpanda (event bus), Redis (cache), and ClickHouse (OLAP). For a
long time none of the three were built. This wasn't drift to quietly
paper over — each was a real, deliberate decision, documented in
`docs/DECISIONS.md`: D9 (materialized views before ClickHouse), D12
(moderation in-process, no event bus). Redis was never revisited because
nothing has needed a cache yet, and still hasn't.

Kafka/Redpanda is the one exception: Phase 30 (D53) built it, deliberately
later and for a different reason than the original Phase 1 plan assumed
— not because moderation itself needed decoupling (D12's in-process
reasoning still holds, unchanged), but as additive, best-effort plumbing
for new downstream consumers that have no other way to react to a write
without polling. `notification-service` (Phase 31, GitHub issue #335) is
the first of those: it consumes `ModerationService`'s `moderation.*.created.v1`
events and sends a "your submission is pending review" email, idempotently
— see the system diagram above and `docs/EVENTS.md` for the full contract.
`review-analyzer` (Phase 32, GitHub issue #339) is the second: its own
consumer group on the same three topics, proving the wiring end to end
before #340 ports the LLM triage logic in and starts publishing a new
`moderation.<type>.verdict_computed.v1` event (D81) for `api` itself to
consume — its first event consumer, not just a producer.
ClickHouse and Redis remain unbuilt; if either gets built later, it'll be
because a concrete trigger fired (real load, real async fan-out), not
because the original diagram said so.

## Deployment shape (current)

- **Local dev, native (fastest):** `api`/`web` run directly with `npm
  run start:dev`, against kind's Postgres and OpenSearch (both via
  port-forward — D24/D26, not Docker Compose's containers) — no
  containers for the app code itself. See `wiki/deployment-guide.md` §1.
- **Local dev, full Compose (Podman) — retired (`docs/DECISIONS.md`
  D97):** `infra/docker-compose.yml` is deleted; `kind` is now the only
  local instance of every backing service (Postgres, OpenSearch,
  Mailpit, Redpanda, LocalStack). §2 (kept as a retirement note, not
  renumbered away).
- **Local dev, full Kubernetes (`kind`):** the closest thing to a real
  deployment this project has. `ingress-nginx` + `metrics-server` via
  Helm; `api`/`web`/`notification-service`/`review-analyzer`/`postgres`/
  `opensearch`/`redpanda`/`localstack` via Kustomize (`infra/k8s/base` +
  `overlays/dev` — `dev` requires LocalStack unconditionally as of
  GitHub issue #466/D76, no separate `dev-localstack` variant anymore).
  §3.
- **CD:** on every push to `main` touching deployable paths, a job
  queues automatically; starting the self-hosted runner picks it up and
  runs build → `kind load` → `kubectl apply -k overlays/dev` → provision
  + reseed LocalStack → rollout restart, fully automated. §4, §7, §8.
- **`staging`/`prod` overlays exist but have never been deployed** —
  structurally complete (own namespace, replica counts, resource limits,
  distinct Ingress hosts), verified to produce valid, genuinely-differing
  `kubectl kustomize` output, but gated on a real Phase 8 trigger (an
  actual shared/staging environment) that hasn't fired yet.
- **CI:** GitHub Actions, GitHub-hosted runners — lint, type-check, test,
  build on every PR, unchanged since Phase 1.

## Repo layout (current)

```
interview-insights/
├── CLAUDE.md
├── docs/
│   ├── ARCHITECTURE.md        (this file)
│   ├── DATA_MODEL.md
│   ├── DECISIONS.md
│   └── ROADMAP.md
├── api/
│   ├── src/
│   │   ├── candidates/ candidate-verification/
│   │   ├── companies/ interview-processes/ rounds/ round-ratings/
│   │   ├── moderation/ fraud-checks/
│   │   ├── search/ analytics/ secrets/ health/ common/
│   │   └── main.ts app.module.ts
│   ├── prisma/                # schema.prisma + migrations/
│   ├── scripts/entrypoint.js  # runs secrets bootstrap before migrate + app
│   └── Dockerfile
├── web/
│   └── src/app/                # wizard, search, analytics pages
├── workers/                    # placeholder — no logic (D12)
├── services/
│   ├── notification-service/   # first standalone microservice (Phase 31, D53/D73)
│   │   ├── prisma/schema.prisma  # own minimal client, no migrations of its own (D75)
│   │   ├── src/notifications/    # NotificationConsumerService — real *.created/*.status_changed consumer (#335/#336)
│   │   ├── src/health/
│   │   └── Dockerfile
│   └── review-analyzer/        # second standalone microservice (Phase 32, D53)
│       ├── src/analysis/         # AnalysisConsumerService — *.created consumer, logs only (#339); LLM triage + verdict_computed publish lands in #340 (D81)
│       ├── src/health/
│       └── Dockerfile
├── infra/
│   ├── aws/                    # seed-localstack.sh, one IAM policy JSON per service
│   ├── k8s/
│   │   ├── base/                # numbered manifests (incl. 10-notification-service.yaml, 11-review-analyzer.yaml) + localstack/ subdir
│   │   └── overlays/
│   │       ├── dev              # actually deployed; requires LocalStack unconditionally (D76)
│   │       ├── staging / prod   # structural only, gated on Phase 8
│   └── terraform/               # empty, gated on a real cloud account
├── wiki/
│   ├── deployment-guide.md      # command-by-command runbook, every environment
│   ├── github-project-setup.md  # gh CLI workflow conventions
│   └── blog/                    # one post per issue, narrative deep-dives
└── .github/workflows/           # ci.yml, cd.yml, self-hosted-smoke-test.yml
```

## Known gaps (surfaced, not yet acted on)

- **`RecruiterInteraction`/`RecruiterRating`/`OverallReview` have zero
  write path.** The schema and migrations have existed since Phase 1,
  but no controller anywhere creates one, `ModerationService` explicitly
  throws `NotImplementedException` for either type, and the two
  corresponding materialized views (`company_recruiter_aggregates`,
  `company_overall_aggregates`) are permanently empty — not "below the
  shrinkage floor," genuinely zero rows possible. The analytics
  dashboard's "recruiter experience" and "overall experience" sections
  will show "Not enough reviews yet" indefinitely until this is built.
  This is a real, sizeable feature gap — building it out is a scoped
  decision for a future planning pass, not something implied by this doc.
- **Fraud/spam volume growth** — the moderation service will need real ML
  scoring (not just rules) once volume grows; revisit as a dedicated
  workstream, don't bolt it onto the write path later.
- **Cross-company comparison queries** — once `normalized_band` is
  populated (see `docs/DATA_MODEL.md`), comparison queries across many
  companies may need their own materialized view rather than joining live.
- **Cold start** — no candidate rates a company with zero existing
  reviews. Likely needs seed data before organic growth kicks in. Not an
  infrastructure concern, but affects launch sequencing.
