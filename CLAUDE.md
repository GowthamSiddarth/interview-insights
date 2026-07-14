# Project: Interview Insights Platform

Candidates rate their interview experience per-round (difficulty, fairness,
interviewer traits) plus their recruiter interactions, rolled up into
company-level analytics dashboards. Think "Glassdoor for interview loops,"
but with structured per-round data instead of just free text.

Read `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, and `docs/DECISIONS.md`
before making structural changes — they contain reasoning you should not
re-litigate without a good reason.

## Core entity hierarchy
```
Company
  └── InterviewProcess (one candidate's application loop)
        ├── Round (phase, title, type, interviewer, description)
        │     └── RoundRating (difficulty, fairness, interviewer traits)
        ├── RecruiterInteraction
        │     └── RecruiterRating (approachability, response time, timeliness)
        └── OverallReview (summary review for the whole process)
```
Full schema: `docs/DATA_MODEL.md`.

## Hard constraints — do not violate without asking first

1. **Never expose real interviewer/recruiter names publicly.** They're stored
   as internal entities (for de-duplication and internal analytics) but shown
   publicly only as a generated label ("Interviewer A", "Round 2 recruiter").
   This is a deliberate defamation-risk mitigation, not an oversight.
2. **Every review/rating write goes through moderation before it's public.**
   `status` starts at `pending` on all rating/review tables. Fraud and spam
   prevention are core to this product, not a later add-on.
3. **Public aggregate scores use shrinkage, never a raw average shown as-is.**
   See the formula in `docs/DATA_MODEL.md` under Aggregation layer. Never
   display a score below `n = 3` samples — return `null` and let the frontend
   show "not enough reviews yet."
4. **One rating per candidate per round/interaction.** Enforced via unique
   constraints in the schema — don't relax this without a specific reason.
5. **Migrations are the source of truth for schema.** Never hand-edit
   production schema directly. Every schema change is a Prisma migration.

## Stack (decided)

| Layer | Choice |
|---|---|
| ORM / migrations | Prisma |
| Primary DB | PostgreSQL |
| Cache | Redis |
| Search | OpenSearch |
| Event bus | Kafka (or Redpanda locally) |
| Analytics store | Postgres materialized views → ClickHouse if/when volume demands it |
| Frontend | Next.js + Tailwind |
| API framework | NestJS (Node/TypeScript) — see D10 in docs/DECISIONS.md |
| Container/orchestration | Docker Compose (local) → Kubernetes (deployed) |
| Cloud provider (Phase 8+, not yet built) | AWS — see D11 in docs/DECISIONS.md |

See `docs/ARCHITECTURE.md` for how these pieces connect and why.

## Conventions

- Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`).
- Every new endpoint needs: unit test, integration test (real Postgres via
  Docker), and an OpenAPI/schema doc update.
- Schema changes always start as a Prisma migration file, never ad hoc SQL.
- Don't add new round-type-specific columns to `rounds` — use the
  `type_metadata` JSONB field (see `docs/DATA_MODEL.md` for examples).

## Build order (see docs/ROADMAP.md for full detail)

1. Repo scaffold + Prisma migrations for core entities
2. Thin vertical slice: one company → process → round → rating, end to end
3. Testing setup (unit + integration)
4. CI (lint/test/build on PR)
5. Moderation queue as its own worker/service
6. Aggregation materialized views + analytics endpoint
7. Containerize all services, docker-compose for local dev
8. k8s manifests (local kind/minikube first, then staging overlay)

## Current status

*Update this section at the end of every working session — this is the
single most useful thing to keep current.*

As of 2026-07-14: Phase 1 (repo scaffold) and Phase 2 (thin vertical slice)
are done.

**Phase 1** — repo layout matches `docs/ARCHITECTURE.md`: `api/` (NestJS),
`web/` (Next.js + Tailwind), `workers/` (placeholder, no logic yet), `infra/`
(docker-compose.yml wired for Postgres/Redis/Redpanda/api/web; `k8s/base`,
`k8s/overlays/{dev,staging,prod}`, `terraform/` are empty placeholders until
Phase 7), `.github/workflows/ci.yml`. Prisma schema
(`api/prisma/schema.prisma`) implements every table in `docs/DATA_MODEL.md`
in the documented migration order, plus the first migration
(`api/prisma/migrations/20260714000000_init`). The 1-5 CHECK constraints on
rating columns aren't expressible in Prisma schema language, so they're
appended as raw SQL at the end of that migration file. Aggregation
materialized views are intentionally NOT in schema.prisma — they'll be raw
SQL in a dedicated migration when Phase 4 starts.

**Phase 2** — Create + Read (scope decision: Update/Delete deferred until
there's auth to gate who can call them, and rating/review edits after
submission would undermine the moderation model anyway) for the full
Company → InterviewProcess → Round → RoundRating chain, plus a Candidates
endpoint (dependency for InterviewProcess — email is hashed server-side with
an HMAC pepper, `EMAIL_HASH_SECRET`, and the raw email is never persisted).
Global `PrismaExceptionFilter` maps unique/FK/not-found Prisma errors to
409/422/404. 38 unit tests (DTO validation + email-hash + Candidate service
logic) and integration e2e tests against a real Postgres (unique-constraint
conflict, moderation gate, validation edge cases) all pass. Minimal Next.js
wizard drives the whole flow; verified by actually running both servers and
driving it with a headless-Chromium (Playwright) script — this caught a real
bug (NestJS doesn't enable CORS by default, so every browser fetch from
`web` to `api` failed preflight even though curl-based checks looked fine)
now fixed via `app.enableCors()` + `CORS_ORIGIN` env var. `api`/`web` build +
lint + test clean; `workers` typechecks.
- Next step: Phase 3 — moderation queue worker, fraud checks, candidate
  verification flow, per `docs/ROADMAP.md`.

## Open decisions still to make

- Exact value of `k` in the shrinkage scoring formula (start at 8, tune later)
- Retention/deletion policy for moderation queue + rejected content (GDPR
  erasure path)
- Whether/when to slice `company_overall_aggregates` by role or level
