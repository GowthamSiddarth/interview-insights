# Engineering blog

A phase-by-phase, issue-by-issue technical write-up of how this project
was actually built — key concepts, core technologies, infra build steps,
system design approach, and the concrete step-by-step path to each
solution. This is a companion to `docs/` (architecture/data
model/decisions reference) and `wiki/github-project-setup.md`
(operational runbook): where those are reference material, this is
narrative — written to be read start to finish, one phase at a time.

Phases 1 and 2 predate this project's GitHub issue/milestone convention
(introduced in Phase 3), so they're split into logical sub-topics instead
of numbered issues. From Phase 3 onward, each post maps to one real GitHub
issue.

## Phase 1 — Foundation

See `docs/ROADMAP.md` Phase 1.

1. [Repo scaffold & stack decisions](phase-1-foundation/01-repo-scaffold-and-stack-decisions/README.md)
2. [Prisma schema & first migration](phase-1-foundation/02-prisma-schema-and-first-migration/README.md)
3. [Local Docker Compose](phase-1-foundation/03-local-docker-compose/README.md)

## Phase 2 — Thin vertical slice

See `docs/ROADMAP.md` Phase 2.

1. [API: Create + Read endpoints](phase-2-vertical-slice/01-api-create-read-endpoints/README.md)
2. [Testing strategy: unit + real-Postgres integration](phase-2-vertical-slice/02-testing-strategy/README.md)
3. [Frontend wizard & real-browser verification](phase-2-vertical-slice/03-frontend-wizard-and-browser-verification/README.md)
