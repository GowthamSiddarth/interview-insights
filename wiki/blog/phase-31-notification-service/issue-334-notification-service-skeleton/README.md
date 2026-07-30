# Phase 31, Issue #334 — `notification-service` Skeleton: This Project's First Standalone Microservice

*Part of Phase 31 — Notification Service. See `docs/ROADMAP.md` Phase 31,
`docs/DECISIONS.md` D53/D73/D75/D78, and `docs/EVENTS.md`.*

## The gap this closed

Phase 30 built a message broker and a producer with nothing consuming
from it. Phase 31's whole point is proving the rest of the pattern this
project has been building toward since D53: a real out-of-cluster
consumer, deployed and rolled out independently of `api`, reading its
own slice of Postgres, with its own least-privilege secrets access. This
issue is that scaffolding — before any actual event-handling logic
exists, `notification-service` needed to be a real, deployable NestJS
app with a health check, a Dockerfile, a k8s manifest, and CI/CD wiring,
so every later issue in this phase is just adding logic to something
that already boots correctly in the cluster.

## Key concept: no Ingress, because this service has no public API

`10-notification-service.yaml`'s own comment states the shape plainly:
this pod is deliberately unreachable from outside the cluster — no
Ingress rule, `/health` reachable in-cluster only, the same posture as
`postgres`/`opensearch`/`redpanda` themselves. Everything this service
does is triggered by consuming from Redpanda, not by receiving requests;
a `ClusterIP` Service plus readiness/liveness probes hitting `/health`
is the entire externally-visible surface.

```yaml
readinessProbe:
  httpGet:
    path: /health
    port: 3002
  initialDelaySeconds: 10
  periodSeconds: 5
  failureThreshold: 10
livenessProbe:
  httpGet:
    path: /health
    port: 3002
  initialDelaySeconds: 20
  periodSeconds: 10
  failureThreshold: 10
```

## Key concept: `prisma generate` without `prisma migrate` — a schema with no migrations directory

`api`'s migrations remain this project's one source of truth for the
actual database schema (CLAUDE.md hard constraint #5) — `notification-service`
never runs `prisma migrate` itself, and deliberately has no
`prisma/migrations/` directory at all (D75). Its own `prisma/schema.prisma`
exists purely to generate a typed client against tables `api`'s
migrations already created. The Dockerfile's build stage reflects this
directly — it generates the client, but there's no migrate-on-boot step
the way `api/scripts/entrypoint.js` has one:

```dockerfile
FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY . .
RUN npm run build
```

## Key concept: its own least-privilege secrets, not a copy of `api`'s

`notification-service` fetches `DATABASE_URL`/`EMAIL_ENCRYPTION_KEY` from
LocalStack Secrets Manager at boot via its own
`localstack-secrets-bootstrap.ts` — structurally identical to `api`'s
version, but assuming its *own* IAM role
(`notification-service-secrets-role`, D78), scoped to only the secrets
this service actually needs. `EMAIL_ENCRYPTION_KEY` has to be the exact
same value as `api`'s own copy of that secret — this service can only
ever decrypt what `api` encrypted under it (a dependency issue #335
would go on to need, once it started actually decrypting candidate
emails) — but everything else in `api`'s secret set (`ADMIN_JWT_SECRET`,
`ANTHROPIC_API_KEY`, etc.) is simply not in this service's IAM policy at
all. No committed plaintext `Secret` exists for either value (D76).

## Step-by-step: what actually got built and verified

1. Scaffolded a minimal NestJS app (`AppModule` importing `HealthModule`
   only, at this point) with its own `package.json`/`tsconfig.json`/
   `eslint.config.mjs`, matching `api`'s existing conventions rather than
   inventing new ones.
2. `GET /health` returns `{ status: 'ok', version: <GIT_SHA> }` — the
   same shape `api`'s own health check already established, baked into
   the image via `--build-arg GIT_SHA` at build time (the same convention
   issue #89 set for `api`).
3. `Dockerfile`: multi-stage build (`base` → `build` → `runtime`),
   `prisma generate` in the build stage, `node_modules`/`dist` copied
   wholesale into the runtime stage rather than a fresh `npm ci
   --omit=dev` — mirroring `api/Dockerfile`'s own pattern.
4. `infra/k8s/base/10-notification-service.yaml`: `ConfigMap` (`PORT`,
   `REDPANDA_BROKERS`, `MAIL_SMTP_HOST`/`MAIL_SMTP_PORT`) + `Service` +
   `Deployment`, `envFrom` pulling the ConfigMap plus (once #466 landed)
   Secrets-Manager-sourced env vars — no committed `Secret` manifest.
5. `.github/workflows/cd.yml`: a path filter on `services/notification-service/**`
   triggers a dedicated build-image / load-into-kind / apply-manifests /
   `kubectl rollout restart deployment/notification-service` sequence,
   parallel to `api`'s own CD steps but entirely independent — this
   service can ship without `api` redeploying at all.
6. `.github/workflows/ci.yml`: a separate `notification-service` CI job
   (its own `working-directory`, its own `package-lock.json` cache key,
   its own Postgres service container) — isolated from `api`'s job the
   same way every other job in this workflow already is, so one
   service's test failure never blocks another's.

## What this enabled

A real pod, in the real `kind` cluster, that boots, reports healthy, and
ships independently of `api` — with no event-consuming logic yet. Issue
#335 is what actually makes it a Redpanda consumer.
