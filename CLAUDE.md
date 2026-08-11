# Project: Interview Insights Platform

Candidates rate their interview experience per-round (difficulty, plus
interviewer traits limited to fluency, clarity, and focus) plus their
recruiter interactions, rolled up into company-level analytics dashboards.
Think "Glassdoor for interview loops," but with structured per-round data
instead of just free text.

Read `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, and `docs/DECISIONS.md`
before making structural changes — they contain reasoning you should not
re-litigate without a good reason. Project history and phase-by-phase status
live in `docs/ROADMAP.md` (scope/status per phase), `docs/DECISIONS.md`
(D-numbered rationale), and `wiki/blog/` (one engineering-blog post per
phase) — read those when picking up in-progress work rather than expecting
this file to carry that history inline.

## Core entity hierarchy
```
Company
  └── InterviewProcess (one candidate's application loop)
        ├── Round (phase, title, type, interviewer, description)
        │     └── RoundRating (difficulty, interviewer traits: fluency/clarity/focus)
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
6. **No secret is ever committed as plaintext — real or placeholder.**
   Every credential, API key, or sensitive config value is either fetched
   from a secrets management service at boot (LocalStack Secrets Manager
   locally via each service's own `localstack-secrets-bootstrap.ts`-style
   module; real AWS Secrets Manager once Phase 8b's actual AWS
   environment exists), or — for the one case where a service needs its
   credential before any of this project's own code exists to fetch one
   (Postgres itself) — provisioned imperatively (`kubectl create secret
   ... --from-literal=$ENV_VAR`, hard-failing if unset, same pattern as
   `admin-credentials`), never baked into a committed k8s manifest, CI
   workflow file, or Dockerfile, and never left as an inert "dev-only,
   change-me" fallback value either. A `.env.example` may document
   *which* env var a service reads; it must never carry a real or
   plausible-looking value. GitHub issue #466 (D76/D77, tracked under the
   Phase 20 epic, #214) brought this project's existing secrets into
   compliance — `postgres-credentials`'s imperative provisioning is the
   one deliberate, documented exception this constraint allows for, not a
   precedent to extend beyond that same narrow "needed before our own
   code can run" justification. See `docs/SECRETS.md` for the full
   inventory of every secret, which pattern each uses, and how to verify
   any of it — read it before adding a new one.

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
| Container/orchestration | Kubernetes (`kind`, local — see D97) → Kubernetes (deployed) |
| Cloud provider (Phase 8+, not yet built) | AWS — see D11 in docs/DECISIONS.md |

See `docs/ARCHITECTURE.md` for how these pieces connect and why.

## Conventions

- Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`).
- **Plan a phase before implementing any of it.** Before writing code for a
  new `docs/ROADMAP.md` phase, break it into GitHub issues (with a milestone)
  covering the whole phase first — same pattern used for Phase 3 (issues
  #1-#3 filed together before any of them were implemented). Implementation
  starts only after that planning pass is done; see
  `wiki/github-project-setup.md` for the `gh` commands.
  **Exception: Phase 8.** It's a trigger-gated menu, not a linear phase —
  see its intro in `docs/ROADMAP.md` for why. Plan (file issues + a
  milestone) one sub-area (8a-8g) at a time, only once that sub-area's own
  trigger fires — never the whole phase's menu upfront.
- **Every phase's planning batch also includes a "write the engineering
  blog for this phase" issue**, filed alongside the phase's feature issues
  during the same planning pass — but implemented *last*, once every other
  issue in the phase is merged, since the post documents the finished
  work. Posts live under `wiki/blog/<phase-slug>/`: one post per GitHub
  issue for phases planned this way, or per logical sub-topic for the
  handful of phases (1-2) that predate the issue/milestone convention.
  Each post covers key concepts, core technologies, infra build steps,
  system design approach, and a step-by-step implementation account — see
  `wiki/blog/README.md` for the index and any existing post for the
  expected depth.
- **Always branch + PR, never commit directly to `main`.** Applies to every
  change, including documentation-only or workflow-convention updates like
  this one — there's no carve-out for changes that don't touch application
  code.
- **Move an issue's board status to "In Progress" the moment work actually
  starts on it** (not when it's filed during planning), and **assign every
  PR to yourself** (`gh pr create --assignee <github-username>`), same as
  issues already are. See `wiki/github-project-setup.md`'s "Workflow
  convention" section for this project's concrete `gh project item-edit`
  IDs.
- **Epics vs Milestones, kept as two distinct concepts.** A phase is an
  **Epic**: a themed, date-less body of work, tracked as a real parent
  issue with the phase's feature issues attached as native GitHub
  sub-issues. The GitHub **Milestone** stays too, but demoted to what
  it's actually good at — a flat, date-less grouping — and is reserved
  to mean a genuine date-bound external commitment only once one
  actually exists (e.g. a real staging-launch date spanning issues from
  more than one phase). See `wiki/github-project-setup.md`'s
  "Epics vs Milestones" section for the concrete sub-issues API commands.
- **Only epics go on the Project board, not individual sub-issues** —
  file/milestone/sub-issue every feature issue as usual, but only
  `gh project item-add` the phase's epic. Each sub-issue's own
  implementing PR must still use a real closing keyword (`Closes #N`)
  so it registers as a linked PR, not just a mention — see
  `wiki/github-project-setup.md`'s "Board hygiene" note.
- **Every dev/test/structural task — even an ad-hoc one — gets tracked
  under a GitHub Epic**, not just planned phase work. Reuse an existing
  epic as a catch-all when the task isn't specific to a phase (this
  project reuses its Phase 20 epic this way). See
  `wiki/github-project-setup.md`'s "Ad-hoc work" section for the
  concrete steps (milestone-by-number when the epic's milestone is
  closed, sub-issue attachment, same-day reopen/close).

Service-specific conventions (test/schema requirements for `api/`, etc.)
live in that directory's own `CLAUDE.md`, layered on top of this file.

## Build order

See `docs/ROADMAP.md` for the full build order and phase-by-phase detail.

## Current status

See `docs/ROADMAP.md` for phase-by-phase scope/status, `docs/DECISIONS.md`
for decision rationale (D-numbered), and `wiki/blog/` for one engineering-blog
post per phase — this file no longer inlines that running history.

- Next step: Phase 31 (Notification Service) is done, blog included.
  Phase 32 (Review Analyzer Service) is fully done, blog included
  (#338-#341). Phase 36 (Moderator Queue SLAs, Assignment &
  Notifications) is fully done too, blog included (issues #485-#492,
  epic #484 closed). Phase 41 (Moderator Queue Priority, Filters &
  Seed-Data Parity) is fully done too, blog included (issues #522-#525,
  epic #521 closed). Phase 40 (CI Infrastructure: Self-Hosted GitHub
  Actions Runner) is the current frontier — #501 (provision the runner
  VM) is next, in progress as of 2026-08-04. The GitHub Actions billing
  gate that prompted Phase 40 was refreshed 2026-08-03 — back to normal
  wait-for-CI-green discipline before merging, not the temporary
  merge-without-CI exception this line used to describe. Phase 42
  (Staff Role Hierarchy & Admin/Moderator Tooling) is planned as of
  2026-08-11 (epic #584, issues #585-#593) and underway: #585 (kickoff
  decision record) is done, written up as D99 in `docs/DECISIONS.md`.
  #586 (the `StaffRole`/`staff_audit_log` Prisma migration) is done too —
  applied and verified live against the kind cluster's Postgres. #587
  (permission-set authorization: `RequirePermission`/`PermissionsGuard`,
  role claim on the staff JWT, re-checked live per request for immediate
  deactivation/role-change effect) is done. #588 (migrating
  `ModerationController`/`AdminRoundTypeFieldOptionsController` to the
  new permission-based guards, plus e2e coverage proving a `staff`
  account can read but not write) is done too. #589 (staff account
  management endpoints — new `StaffAccountsModule`/`admin/staff` routes
  for create/list/update-role/deactivate/reactivate/admin-reset-password,
  self-service `POST /auth/admin/change-password`, every action durably
  audited via `StaffAuditLogService`) is done too. Next up is #590
  (retiring the shared admin credential for the general case, narrowing
  `rotate-admin-credentials.sh` to root-admin break-glass recovery).

## Open decisions still to make

See `docs/DECISIONS.md`'s "Still open" section for the current list.
