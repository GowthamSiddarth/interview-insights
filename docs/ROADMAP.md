# Build roadmap

Phased so each step produces something testable before adding the next
layer of complexity. Update the checkboxes as you go — this is a good
companion to the "Current status" section in `CLAUDE.md`.

## Phase 1 — Foundation
- [x] Repo scaffold matching the layout in `docs/ARCHITECTURE.md`
- [x] Prisma schema + first migration implementing `docs/DATA_MODEL.md`,
      in the order listed under "Migration ordering"
- [x] Local Docker Compose (Postgres, Redis, Redpanda)

## Phase 2 — Thin vertical slice
- [x] Create + Read for Company → InterviewProcess → Round → RoundRating, API
      only (Update/Delete intentionally deferred — see CLAUDE.md current status)
- [x] Minimal frontend flow to create/view one full slice end to end
- [x] Unit tests for validation logic
- [x] Integration tests against a real test Postgres (Dockerized)

## Phase 3 — Trust & moderation
- [ ] Moderation queue as its own service/worker
- [ ] Basic fraud checks (rate limiting, duplicate detection) before any
      launch traffic — see D3 in `docs/DECISIONS.md`, this is not optional
- [ ] Candidate verification flow (email domain match at minimum)

## Phase 4 — Analytics
- [ ] Materialized views per `docs/DATA_MODEL.md` Aggregation layer section
- [ ] Shrinkage scoring implemented at the API layer (D4)
- [ ] `/companies/:id/analytics` endpoint
- [ ] Dashboard UI (company / round-type / recruiter views)

## Phase 5 — Search & discovery
- [ ] OpenSearch indexing for company + review search
- [ ] Filtering by role, round type, date range

## Phase 6 — CI/CD & containerization
- [x] GitHub Actions: lint, type-check, test, build on PR (built during
      Phase 1 scaffolding, ahead of sequence — `.github/workflows/ci.yml`)
- [x] Dockerfile per service (api, web, workers) (ditto)

## Phase 7 — Kubernetes
- [ ] Local kind/minikube cluster with plain manifests
      (`infra/k8s/base`: Deployment, Service, Ingress, ConfigMap, Secret)
- [ ] Staging overlay via Kustomize
- [ ] Move to Helm only if manifests become genuinely repetitive across
      services/environments

## Deferred until real usage data exists
- `normalized_band` / `company_level_mappings` population (D5)
- ClickHouse migration for analytics (only if materialized views strain)
- Tuning `k` in the shrinkage formula
