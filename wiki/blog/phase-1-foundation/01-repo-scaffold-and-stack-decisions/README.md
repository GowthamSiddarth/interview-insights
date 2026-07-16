# Phase 1.1 — Repo Scaffold & Stack Decisions

*Part of Phase 1 — Foundation. See `docs/ROADMAP.md` Phase 1, `docs/ARCHITECTURE.md`.*

## Why this came first

Every subsequent phase in this project — the vertical slice, moderation,
analytics, search, Kubernetes — assumes a specific shape of repo and a
specific set of technology choices already exist. Getting those choices
right (or at least deliberate) before writing any feature code avoids the
much more expensive mistake of discovering a structural problem three
phases in. This post covers the very first working session: turning a
one-paragraph product idea ("Glassdoor for interview loops, but
structured") into a repo that could actually be built on.

## Key concepts

- **Monorepo, multi-service layout.** One Git repository, three
  independently deployable services (`api`, `web`, `workers`) plus an
  `infra/` directory for anything that isn't application code. This is not
  a monolith — each service has its own `package.json`, its own
  Dockerfile, its own CI job — it's just co-located for now because a
  single developer coordinating three separate repos adds overhead with no
  offsetting benefit yet.
- **Docs as the source of truth for structure, not just narration.**
  `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/DECISIONS.md`, and
  `docs/ROADMAP.md` were written *before* scaffolding, and the scaffold's
  job was to match them — not the other way around. `CLAUDE.md` exists
  specifically to force this discipline on any future session (including
  AI-assisted ones): read the docs, don't re-derive the architecture from
  scratch each time.
- **Decide once, log it, move on.** `docs/DECISIONS.md` is a lightweight
  ADR (architecture decision record) log — every non-trivial choice
  (ORM, framework, cloud target) gets one dated entry with a **Decision**
  and a **Why**, so a later session doesn't re-litigate something already
  settled. This is the single biggest lever for keeping a long-running,
  multi-session project coherent.

## Core technologies chosen and why

| Layer | Choice | Why (see `docs/DECISIONS.md`) |
|---|---|---|
| Primary DB | PostgreSQL | D1 — the domain is fundamentally relational (rounds belong to processes, ratings belong to rounds, aggregates roll up hierarchically); JSONB absorbs the genuinely flexible parts instead of forcing a document model |
| ORM / migrations | Prisma | D6 — user preference, locked in early to avoid retrofitting a different migration tool onto an existing schema later |
| API framework | NestJS (Node/TypeScript) | D10 — opinionated module/controller/service structure pairs naturally with Prisma (same TS runtime, no cross-language client generation), and enforces structure early, which matters once endpoints multiply from Phase 2 onward |
| Frontend | Next.js + Tailwind | Fast to stand up a real, testable UI without a separate design system decision blocking progress |
| Search | OpenSearch | Postgres full-text search doesn't scale to faceted search (role, round type, date range) — deferred until Phase 5 actually needed it, not built day one |
| Event bus | Kafka / Redpanda | Decouples writes from aggregation — also deferred until a real consumer exists (see the Phase 1.3 docker-compose post for how this played out in practice) |
| Cloud target | AWS | D11 — fixed *which* cloud only for when Phase 8's triggers fire; nothing built yet |

The throughline across every choice: pick the option that's correct for
the target architecture, but don't stand up the infrastructure for it
until something in the code actually depends on it. `docs/DECISIONS.md`
D9 names this explicitly — "avoid premature infrastructure" — and it's
referenced repeatedly in later decisions (D12, D13, D16) as the reason
moderation, fraud checks, and search indexing all run in-process rather
than through a message bus that has no other consumer yet.

## System design approach

`docs/ARCHITECTURE.md`'s system overview diagram describes the **target**
shape: web/mobile → API layer → Postgres + a moderation queue + OpenSearch,
with Kafka feeding a ClickHouse/OLAP rollup and Redis caching hot
aggregates. Almost none of that existed after this session — and that's
the point. The diagram is a north star, not a day-one checklist. Phase 1's
actual job was narrower:

1. Repo layout that could grow into every box in that diagram without a
   restructure later (`workers/` exists as an empty placeholder from day
   one specifically so Phase 3's moderation logic and Phase 4's
   aggregation logic have an obvious home when they're ready, even though
   nothing runs there yet).
2. A schema (Postgres via Prisma) that models the real domain entities
   correctly, since getting *this* wrong is the expensive kind of mistake —
   see the companion post on the Prisma schema and first migration.
3. A CI pipeline from the very start, built slightly ahead of its formal
   place in `docs/ROADMAP.md` (Phase 6) — because once there's any code at
   all, having lint/build/test gates on every PR is what makes it safe to
   keep moving quickly in later phases without manually re-verifying
   everything each time.

## Step-by-step: what actually got built

1. **Wrote the docs first.** `docs/ARCHITECTURE.md` (system shape and
   why), `docs/DATA_MODEL.md` (full schema spec — the actual source of
   truth for every table), `docs/DECISIONS.md` (empty ADR log, ready for
   entries), `docs/ROADMAP.md` (the phase-by-phase build order this whole
   blog series follows). `CLAUDE.md` was written to point any future
   session (human or AI) at these docs before making structural changes.
2. **Created the directory skeleton** matching `docs/ARCHITECTURE.md`'s
   "Suggested repo layout":
   ```
   interview-insights/
   ├── CLAUDE.md
   ├── docs/
   ├── api/            (NestJS)
   ├── web/            (Next.js + Tailwind)
   ├── workers/        (placeholder — no logic until Phase 3+)
   ├── infra/          (docker-compose.yml, k8s/, terraform/)
   └── .github/workflows/
   ```
3. **Scaffolded `api/`** with NestJS's CLI conventions (modules,
   controllers, services) and wired up Prisma as the ORM — `npx prisma
   init`, then hand-wrote `schema.prisma` against `docs/DATA_MODEL.md`
   rather than reverse-engineering it from an existing database (there
   wasn't one yet).
4. **Scaffolded `web/`** with Next.js (App Router) and Tailwind — deferred
   any actual UI work to Phase 2, this step just proved the two services
   could be built and typechecked independently.
5. **Left `workers/` as an empty placeholder** — a `package.json` and
   nothing else. Its first real logic doesn't land until much later
   (moderation ended up staying in-process inside `api` per D12, so
   `workers/` is still empty as of this writing — a deliberate outcome,
   not an oversight, revisited each time a candidate workload for it comes
   up).
6. **Set up `.github/workflows/ci.yml`** ahead of `docs/ROADMAP.md`'s
   formal Phase 6 slot — lint, build, and test jobs per service
   (`api`, `web`, `workers`), each running independently so a failure in
   one doesn't block visibility into the others. This was a deliberate
   sequencing call: once there's any code to break, having CI catch
   regressions is what makes it safe to move quickly afterward, rather
   than manually re-verifying every change by hand.
7. **Cleaned up the initial changelist** — checked `git status` for
   anything that shouldn't be tracked (editor-specific `.idea/` files from
   local IDE config) and added it to `.gitignore` rather than committing
   it, keeping the repo's history free of machine-specific noise from the
   very first commit.
8. **Chose to keep the GitHub repo private** with no `LICENSE` file for
   now — a solo, pre-launch project doesn't need to make a public-license
   decision yet, and that's easy to revisit later without cost.

## What this enabled

Every later phase in this series builds directly on this scaffold without
restructuring it: Phase 2's vertical slice added real routes inside the
existing `api`/`web` skeletons; Phase 3's moderation queue became a new
NestJS module inside `api` rather than requiring a new service; Phase 7's
Kubernetes manifests target the exact same `api`/`web`/`workers` shape
`docs/ARCHITECTURE.md` described from day one. The scaffold's success
metric isn't how much it does on day one — it's how little it had to
change six phases later.
