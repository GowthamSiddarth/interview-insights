# Architecture

## System overview

```
Next.js web/mobile
        │
        ▼
    API layer  (auth, validation, rate limiting)
    ├──────────────┬──────────────┐
    ▼              ▼              ▼
PostgreSQL   Moderation queue   OpenSearch
(rounds,     (spam/fraud        (company +
ratings,      checks)            review search)
reviews)          │                  │
    │             ▼                  ▼
    ▼        Moderation          Redis cache
Kafka        service             (hot aggregates,
event bus    (human review        sessions)
    │         + ML flags)
    ▼
ClickHouse / OLAP
(pre-aggregated rollups)
    │
    ▼
Analytics dashboard
(company / round / recruiter views)
```

## Why this shape

- **Postgres as primary store, not a document DB.** The domain is
  relational by nature — rounds belong to processes, ratings belong to
  rounds, aggregates roll up hierarchically. JSONB columns absorb the
  genuinely flexible parts (per-round-type metadata) without forcing the
  whole schema into a document model.
- **Materialized views before ClickHouse.** Don't stand up a second
  analytics store until Postgres materialized views actually strain under
  load. Premature infrastructure here is wasted complexity — see
  `docs/DECISIONS.md`.
- **Kafka/event bus decouples writes from aggregation.** A rating write
  should be fast and not block on recomputing rollups. Stream the write as
  an event; let a separate consumer update aggregates asynchronously.
- **Moderation is a first-class service, not a check inline in the write
  path.** Every rating/review lands as `pending` and only becomes visible
  once approved — this keeps the write path simple and makes the
  moderation logic independently testable and improvable.
- **Search is separate from the primary store.** Postgres full-text search
  doesn't scale well to the faceted search a company/review browsing
  experience needs (filter by role, round type, date range, etc.) —
  OpenSearch is purpose-built for that.

## Deployment shape (target state)

- **Local dev:** Docker Compose running Postgres, Redis, Redpanda (Kafka-
  compatible, lighter for local use), and the app services.
- **Staging/prod:** Kubernetes. Start with plain manifests
  (Deployment/Service/Ingress/ConfigMap/Secret) per service in
  `infra/k8s/base`, add Kustomize overlays per environment
  (`infra/k8s/overlays/{dev,staging,prod}`) once there's more than one
  environment to manage. Don't reach for Helm until the manifests are
  genuinely repetitive across services.
- **CI:** GitHub Actions — lint, type-check, test, build on every PR. This
  is what makes it safe to hand larger changes to Claude Code later; it can
  rely on CI to catch regressions rather than you manually verifying
  everything.

## Suggested repo layout

```
interview-insights/
├── CLAUDE.md
├── docs/
│   ├── ARCHITECTURE.md       (this file)
│   ├── DATA_MODEL.md
│   ├── DECISIONS.md
│   └── ROADMAP.md
├── api/
│   ├── src/
│   ├── prisma/                # schema.prisma + migrations/
│   ├── tests/
│   └── Dockerfile
├── web/
│   ├── src/
│   ├── tests/
│   └── Dockerfile
├── workers/                   # aggregation + moderation background jobs
├── infra/
│   ├── docker-compose.yml
│   ├── k8s/
│   │   ├── base/
│   │   └── overlays/
│   └── terraform/              # once cloud resources are needed
└── .github/workflows/
```

## Known scale risks / things to revisit

- **Fraud/spam volume growth** — the moderation service will need real ML
  scoring (not just rules) once volume grows; revisit as a dedicated
  workstream, don't bolt it onto the write path later.
- **Cross-company comparison queries** — once `normalized_band` is
  populated (see `docs/DATA_MODEL.md`), comparison queries across many
  companies may need their own materialized view rather than joining live.
- **Cold start** — no candidate rates a company with zero existing reviews.
  Likely needs seed data (aggregated from legally permitted public sources,
  or community partnerships) before organic growth kicks in. Not an
  infrastructure concern, but affects launch sequencing.
