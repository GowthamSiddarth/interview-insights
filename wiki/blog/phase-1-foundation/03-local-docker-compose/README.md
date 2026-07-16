# Phase 1.3 — Local Docker Compose

*Part of Phase 1 — Foundation. See `docs/ROADMAP.md` Phase 1, `docs/ARCHITECTURE.md`
"Deployment shape", `docs/DECISIONS.md` D9.*

## Why this came first

`api` needs a real Postgres to run against from the very first endpoint —
Phase 2's vertical slice can't be built or tested without one. Rather than
requiring a hand-installed local Postgres (version drift, port conflicts,
"works on my machine" risk), the project standardized on Docker Compose
for every stateful local dependency from day one. This post is about that
decision, and about a second, more interesting decision made shortly
after: pulling back from the more elaborate compose file
`docs/ARCHITECTURE.md`'s target architecture originally implied.

## Key concepts

- **Local dev infra should mirror production's *shape*, not its scale.**
  `docs/ARCHITECTURE.md`'s "Deployment shape" section originally described
  local dev as "Docker Compose running Postgres, Redis, Redpanda (Kafka-
  compatible, lighter for local use), and the app services" — matching the
  full target architecture diagram (Postgres + moderation queue +
  OpenSearch + Kafka + Redis + ClickHouse). That's the right end state to
  design *toward*, but it's the wrong thing to actually *run* before any
  code depends on it.
- **Premature infrastructure is a real cost, not a free hedge**
  (`docs/DECISIONS.md` D9). Every extra service in `docker-compose.yml` is
  something to start, keep healthy, debug when it misbehaves, and explain
  to anyone else who clones the repo — before a single line of code reads
  or writes to it. D9 names this explicitly: "avoid premature
  infrastructure... a second analytics datastore adds real operational
  complexity that isn't justified until there's evidence it's needed" —
  and the same reasoning applies just as much to Redis and Kafka/Redpanda
  as it does to ClickHouse.
- **Add a service the same day the code first needs it, not before.**
  This became the running rule for the rest of the project:
  `docs/ROADMAP.md`'s Phase 8e (Redis) entry states it outright — "this is
  why it was removed from `infra/docker-compose.yml` in the first place"
  — and OpenSearch's later addition in Phase 5 (`docs/DECISIONS.md`
  references this same file) is the concrete proof the pattern held:
  OpenSearch was added to compose in the exact same PR that first wrote
  code depending on it, not before.

## Core technologies

- **Docker Compose** (`infra/docker-compose.yml`) as the single local-dev
  entry point — one `docker compose up` for every stateful dependency.
- **`postgres:16-alpine`** — the same major version targeted in
  production, a named volume (`postgres_data`) so data survives a
  container restart, and a `pg_isready`-based healthcheck so dependent
  services (later, `api`'s container) can `depends_on: condition:
  service_healthy` instead of racing a not-yet-ready database.
- **Docker Desktop** on macOS as the actual runtime — installed via
  Homebrew cask (`brew install --cask docker`).

## System design approach

The guiding question for *everything* in `infra/docker-compose.yml`,
applied for the first time here and reapplied at every later phase: **does
any code in this repo actually read or write to this service yet?**

Applied to the original target list:
- **Postgres** — yes, immediately. `api`'s Prisma schema exists and needs
  a real database to migrate against. Keep it.
- **Redis** — no. Nothing in `api` reads or writes a cache yet; Phase 3's
  rate-limiting and Phase 4's aggregate caching are the eventual real
  consumers (`docs/ROADMAP.md` Phase 8e), and neither exists yet. Cut it.
- **Redpanda (Kafka-compatible)** — no. `docs/ARCHITECTURE.md`'s diagram
  describes rating writes streaming as events to a consumer that updates
  aggregates asynchronously — but at this point there's no write path at
  all yet, let alone a consumer. Cut it.
- **`api`/`web` themselves** — no, not in Compose yet either. Both run
  directly on the host via `npm run start:dev` / `npm run dev` for the
  fastest possible local iteration loop (instant reload, no image rebuild
  per change). Containerizing them is Phase 6 work, once there's a
  Dockerfile worth testing.

The result: Phase 1's `infra/docker-compose.yml` runs exactly one service,
Postgres, and nothing else — a direct, deliberate narrowing from
`docs/ARCHITECTURE.md`'s original aspirational list down to only what
Phase 1's actual code needs. `docs/ARCHITECTURE.md` itself keeps
describing the fuller target shape (that's its job — it's the north star),
while `docs/DECISIONS.md` D9 and `CLAUDE.md`'s running status log record
the narrower, code-driven reality of what's actually running at any given
point. Every later phase that adds a service to Compose (OpenSearch in
Phase 5, `api`/`web` behind a `full` profile in Phase 6) follows this
exact same test before being added — see those phases' own blog posts for
how each one earned its place.

## Step-by-step: what actually got built

1. **Started from `docs/ARCHITECTURE.md`'s deployment-shape description**
   as the initial draft: Postgres, Redis, Redpanda.
2. **Applied the "does code depend on this yet" test** to each service
   (see above) and cut Redis and Redpanda, keeping only Postgres for this
   phase.
3. **Wrote `infra/docker-compose.yml`** with a single `postgres` service:
   ```yaml
   services:
     postgres:
       image: postgres:16-alpine
       restart: unless-stopped
       environment:
         POSTGRES_USER: postgres
         POSTGRES_PASSWORD: postgres
         POSTGRES_DB: interview_insights
       ports:
         - "5432:5432"
       volumes:
         - postgres_data:/var/lib/postgresql/data
       healthcheck:
         test: ["CMD-SHELL", "pg_isready -U postgres"]
         interval: 5s
         timeout: 5s
         retries: 10
   volumes:
     postgres_data:
   ```
4. **Installed Docker Desktop** (`brew install --cask docker`, then
   launched the app once so its daemon actually starts — the CLI alone
   isn't enough on macOS). One real gotcha hit during this step, worth
   recording for anyone repeating it: a prior, incompletely-removed Docker
   install had left stale symlinks in `/usr/local/bin` pointing at
   binaries that no longer existed, so `docker compose up` failed with
   `command not found` even after reinstalling. Diagnosed with `ls -la
   /usr/local/bin/docker*` (revealing broken symlink targets) and fixed by
   removing the stale links before reinstalling cleanly.
5. **Verified the loop end to end**: `cd infra && docker compose up -d`,
   confirmed the container reached `healthy` via `docker compose ps`, then
   connected with `psql` directly against `localhost:5432` to confirm the
   database was actually reachable — not just that the container started.
6. **Documented connection details in the root `README.md`** (host, port,
   database, user, password) so connecting a GUI client like DBeaver
   doesn't require reading `docker-compose.yml` directly — a small thing,
   but it's the first piece of the "quick start" documentation every later
   phase's README updates build on.
7. **Confirmed `docker compose down` / `docker compose down -v` semantics**
   explicitly — the former stops containers but keeps the named volume
   (data persists across a restart), the latter also wipes the volume for
   a genuinely fresh start. Both matter once real test data accumulates in
   later phases.

## What this enabled

Every subsequent phase's "spin up a real Postgres and test against it"
requirement — Phase 2's integration tests, Phase 3's moderation e2e
suite, Phase 4's materialized-view tests — runs against this exact same
container, unchanged in shape (image, credentials, healthcheck) from this
first version. When Phase 5 needed OpenSearch, it was a genuinely new
service added to this same file following the identical reasoning process
documented here; when Phase 6 needed to containerize `api`/`web`
themselves, they were added behind a separate Compose *profile*
(`full`) specifically so this phase's fast, Postgres-only default loop
never regressed for routine day-to-day development. The discipline
established here — one clear test before adding anything to local infra —
is the reason `infra/docker-compose.yml` never became a dumping ground for
services nothing uses.
