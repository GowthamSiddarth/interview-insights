# Phase 32, Issue #339 — `review-analyzer` Service Skeleton: This Project's Second Standalone Microservice

*Part of Phase 32 — Review Analyzer Service. See `docs/ROADMAP.md` Phase 32,
`docs/DECISIONS.md` D53/D81, and `docs/EVENTS.md`.*

## The gap this closed

Issue #338 decided *how* a verdict would eventually get back into `api`,
but nothing existed yet to compute one. Following the same "prove the
plumbing before adding the real logic" sequencing Phase 31 used for
`notification-service` (skeleton in #334, first real consumer in #335),
this issue built `review-analyzer` as a real, deployable NestJS service —
own Dockerfile, own k8s manifest, own CI/CD wiring, a real Redpanda
consumer subscribed to all three `moderation.*.created.v1` topics — before
any LLM call or verdict-publishing logic existed. At the end of this
issue the service only logs that it received an event; issue #340 gives
it a body.

## Key concept: the second consumer group proves the pattern generalizes

`notification-service` was this project's first out-of-cluster consumer;
this issue is the first time a *second* one was added, in its own
`review-analyzer` consumer group. Every consumer group gets its own
independent copy of every message published to a topic — so
`review-analyzer` subscribing to the same three `moderation.*.created.v1`
topics `notification-service` already reads from doesn't compete with it
or require any coordination between the two. Structurally this issue is
close to a copy of #334's skeleton (no public HTTP surface, no Ingress,
`/health` reachable in-cluster only, the same readiness/liveness probe
shape), which is deliberate — proving the broker/consumer pattern
generalizes cleanly to a second, unrelated service is exactly what this
issue is for, versus inventing a new shape from scratch.

```ts
const TOPICS = [ROUND_RATING_CREATED_V1_TOPIC, RECRUITER_RATING_CREATED_V1_TOPIC, OVERALL_REVIEW_CREATED_V1_TOPIC];
```

Connection handling also mirrors `notification-service`'s consumer
directly (GitHub issue #461's pattern, itself already proven in
production): a lost or never-established broker connection is caught and
logged rather than crash-looping the pod, with `retryConnectIfNeeded()`
polling every 30 seconds until it reconnects.

## Key concept: own Prisma schema, own port, own everything — nothing shared with `api` or `notification-service`

Same D75 precedent `notification-service` set: `review-analyzer` has its
own `prisma/schema.prisma` (no `prisma/migrations/` directory — `api`'s
migrations stay the one source of truth per CLAUDE.md hard constraint
#5) generating a typed client against tables `api`'s migrations already
created, its own Dockerfile building only `prisma generate` (no
migrate-on-boot step), and its own port (3003, one past
`notification-service`'s 3002). The event schemas it consumes
(`RoundRatingCreatedEventV1` etc.) are duplicated into
`review-analyzer/src/events/schemas/` rather than imported from `api` or
`notification-service` — the same duplicate-rather-than-share choice
both existing services already made, so no service's deploy is ever
blocked on another's package changes.

## Step-by-step: what actually got built and verified

1. Scaffolded a minimal NestJS app (`AppModule` importing `HealthModule`
   and the new `EventsModule`/`AnalysisModule` only) with its own
   `package.json`/`tsconfig.json`/`eslint.config.mjs`, matching the
   conventions `api` and `notification-service` already established.
2. `GET /health` returns the same `{ status: 'ok', version: <GIT_SHA> }`
   shape both existing services already use, baked in via `--build-arg
   GIT_SHA` at build time.
3. `AnalysisConsumerService`: subscribes to the three `*.created.v1`
   topics in its own `review-analyzer` consumer group, parses and
   validates each event (`candidateId` present, `eventType` one of the
   three recognized values), and at this point only logs receipt —
   `processEvent()`'s real body (compute a verdict, publish
   `verdict_computed`) is issue #340's job.
4. `Dockerfile`: the same `base → build → runtime` multi-stage shape as
   `notification-service`'s own, `prisma generate` in the build stage,
   `node_modules`/`dist` copied wholesale into the runtime stage.
5. `infra/k8s/base/11-review-analyzer.yaml`: `ConfigMap` + `Service` +
   `Deployment`, no Ingress, readiness/liveness probes against
   `/health` — wired into the dev/staging/prod overlays alongside the
   existing services.
6. `.github/workflows/ci.yml`/`cd.yml`: a separate `review-analyzer` job
   in each — its own `working-directory`, its own Postgres/Redpanda
   service containers for CI, its own path-filtered build/kind-load/
   rollout sequence for CD — isolated from both `api`'s and
   `notification-service`'s jobs, so none of the three can block another.
7. Docs updated to reflect the new service: `docs/ARCHITECTURE.md`'s
   diagram, component table, and repo tree; `docs/EVENTS.md` naming
   `review-analyzer` as the second real consumer alongside
   `notification-service`.

## What this enabled

A real pod, in the real cluster, that boots, reports healthy, and
consumes every `moderation.*.created.v1` event into its own logs — with
no analysis logic yet. Issue #340 is what actually gives it something to
say back.
