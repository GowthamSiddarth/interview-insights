# Interview Insights Platform

Candidates rate their interview experience per-round (difficulty, fairness,
interviewer traits) plus recruiter interactions, rolled up into
company-level analytics. See `CLAUDE.md` and `docs/` for the full
architecture, data model, and decisions log.

Currently implemented: Phases 1-4 (repo scaffold, a Create+Read vertical
slice, trust & moderation, and analytics) plus part of Phase 5 (search).
See `docs/ROADMAP.md` for what's next and `CLAUDE.md`'s "Current status"
for what was last verified working.

## Prerequisites

- Node.js 22+
- Docker — used for Postgres and OpenSearch locally. `api` and `web` run
  directly on the host with npm. If you don't have Docker yet:
  - macOS: `brew install --cask docker`, then open the Docker app once so
    its daemon starts (or install Docker Desktop from
    [docker.com](https://www.docker.com/products/docker-desktop/))
  - Otherwise follow the [Docker Engine install docs](https://docs.docker.com/engine/install/)
    for your OS
- Optional: a Postgres client (DBeaver, TablePlus, `psql`) for poking at the
  database directly

## Quick start

**1. Start Postgres + OpenSearch**

```bash
cd infra
docker compose up -d
```

This starts `postgres` (`localhost:5432`) and `opensearch`
(`localhost:9200`) — see `infra/docker-compose.yml`. Nothing else runs in
Docker by default — `api`/`web` don't yet depend on Redis or Kafka, so
those aren't started until something actually needs them
(docs/DECISIONS.md D9).

**2. Set up and run the API**

```bash
cd api
cp .env.example .env        # defaults already match the compose Postgres above
npm install
npx prisma migrate deploy   # applies api/prisma/migrations against the DB
npm run start:dev           # http://localhost:3001, watches for changes
```

Confirm it's up: `curl http://localhost:3001/health` → `{"status":"ok"}`

**3. Set up and run the web app** (separate terminal)

```bash
cd web
cp .env.example .env.local  # Next.js convention — NOT .env
npm install
npm run dev                 # http://localhost:3000
```

**4. Use it**

Open `http://localhost:3000` and walk through the flow: create a company →
enter a candidate email + role to start an interview process → add a round
→ submit a rating. The rating will show as `pending` — every rating/review
is moderation-gated before it's public (see `docs/DECISIONS.md` D3), and
there's no moderation worker yet (Phase 3), so the public ratings count
stays at `0` by design.

**Stopping/resetting:** `docker compose down` stops Postgres and OpenSearch
(data persists in named volumes). Add `-v` to also wipe the data and start
fresh next time.

### Alternative: full-stack Docker Compose

For prod-like local testing of the actual `api`/`web` Docker images
(rather than the fast host-based loop above):

```bash
cd infra
docker compose --profile full up --build
```

This builds and runs `api` and `web` as containers alongside `postgres`.
Migrations are applied automatically when the `api` container starts (no
manual `prisma migrate deploy` step needed) — see `api/Dockerfile`. Same
ports as the host-based setup: web at `http://localhost:3000`, api at
`http://localhost:3001`.

## Connecting a database client (DBeaver, etc.)

With Postgres running via the Docker Compose above, connect using the
credentials from `infra/docker-compose.yml` (same values are in
`api/.env.example`'s `DATABASE_URL`):

| Field    | Value                |
| -------- | -------------------- |
| Host     | `localhost`          |
| Port     | `5432`               |
| Database | `interview_insights` |
| Username | `postgres`           |
| Password | `postgres`           |

## Running tests

```bash
# api — unit tests (no DB needed)
cd api && npm test

# api — integration/e2e tests (needs the Postgres container up and migrated)
npm run test:e2e

# web — unit tests
cd web && npm test
```

CI (`.github/workflows/ci.yml`) runs lint, build, and both test suites for
`api`, `web`, and `workers` on every PR against a real Postgres service
container — it doesn't use `infra/docker-compose.yml` directly, but the same
schema/migrations apply.

## API endpoints (Phase 2 slice)

| Method | Path                                                 | Notes                                                   |
| ------ | ---------------------------------------------------- | ------------------------------------------------------- |
| GET    | `/health`                                            | DB connectivity check                                   |
| POST   | `/candidates`                                        | Upserts by email (server-side hashed, never stored raw) |
| GET    | `/candidates/:id`                                    |                                                         |
| POST   | `/companies`                                         |                                                         |
| GET    | `/companies` / `/companies/:id`                      |                                                         |
| POST   | `/companies/:companyId/processes`                    |                                                         |
| GET    | `/companies/:companyId/processes` / `/processes/:id` |                                                         |
| POST   | `/processes/:processId/rounds`                       |                                                         |
| GET    | `/processes/:processId/rounds`                       |                                                         |
| POST   | `/rounds/:roundId/ratings`                           | Always created as `pending`                             |
| GET    | `/rounds/:roundId/ratings`                           | Only ever returns `approved` ratings                    |

## Project layout

```
api/       NestJS API (Prisma schema + migrations live here)
web/       Next.js + Tailwind frontend
workers/   Background workers (moderation, aggregation) — placeholder, Phase 3+
infra/     docker-compose.yml (Postgres by default, full-stack behind the
           `full` profile — see above), k8s manifests (Phase 7), terraform
           (future)
docs/      Architecture, data model, decisions log, roadmap
```

Read `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, and `docs/DECISIONS.md`
before making structural changes, and see `CLAUDE.md`'s "Current status"
for what was last verified working.
