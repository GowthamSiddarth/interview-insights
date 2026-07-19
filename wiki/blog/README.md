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

## Phase 3 — Trust & moderation

See `docs/ROADMAP.md` Phase 3. One post per GitHub issue from here on.

1. [Issue #1 — Moderation queue](phase-3-trust-moderation/issue-1-moderation-queue/README.md)
2. [Issue #2 — Fraud checks](phase-3-trust-moderation/issue-2-fraud-checks/README.md)
3. [Issue #3 — Candidate verification](phase-3-trust-moderation/issue-3-candidate-verification/README.md)

## Phase 4 — Analytics

See `docs/ROADMAP.md` Phase 4.

1. [Issue #7 — Aggregation materialized views](phase-4-analytics/issue-7-materialized-views/README.md)
2. [Issue #8 — Shrinkage scoring](phase-4-analytics/issue-8-shrinkage-scoring/README.md)
3. [Issue #9 — Analytics endpoint](phase-4-analytics/issue-9-analytics-endpoint/README.md)
4. [Issue #10 — Dashboard UI](phase-4-analytics/issue-10-dashboard-ui/README.md)

## Phase 5 — Search & discovery

See `docs/ROADMAP.md` Phase 5.

1. [Issue #21 — OpenSearch setup & company search](phase-5-search-discovery/issue-21-opensearch-company-search/README.md)
2. [Issue #22 — Review search with faceted filtering](phase-5-search-discovery/issue-22-review-search-faceted-filtering/README.md)
3. [Issue #23 — Search UI](phase-5-search-discovery/issue-23-search-ui/README.md)

## Phase 6 — CI/CD & containerization

See `docs/ROADMAP.md` Phase 6.

1. [Issue #17 — Full-stack Docker Compose](phase-6-cicd-containerization/issue-17-fullstack-docker-compose/README.md)
2. [Issue #18 — Branch protection (blocked)](phase-6-cicd-containerization/issue-18-branch-protection-blocked/README.md)

## Phase 7 — Kubernetes

See `docs/ROADMAP.md` Phase 7. All three issues are done — this phase's
blog is complete.

1. [Issue #27 — Base manifests for Postgres & OpenSearch](phase-7-kubernetes/issue-27-postgres-opensearch-manifests/README.md)
2. [Issue #28 — Base manifests for api, web & Ingress](phase-7-kubernetes/issue-28-api-web-ingress-manifests/README.md)
3. [Issue #29 — Kustomize overlays for dev/staging/prod](phase-7-kubernetes/issue-29-kustomize-overlays/README.md)

## Phase 9 — UX/UI Polish Pass

See `docs/ROADMAP.md` Phase 9. All five issues are done — this phase's
blog is complete.

1. [Issue #57 — Remove internal dev-note leaks and fix stale moderation copy](phase-9-ux-ui-polish/issue-57-dev-note-cleanup/README.md)
2. [Issue #58 — Persistent shared navigation](phase-9-ux-ui-polish/issue-58-shared-navigation/README.md)
3. [Issue #59 — Wizard: change company without a page reload](phase-9-ux-ui-polish/issue-59-wizard-change-company/README.md)
4. [Issue #60 — Visual design pass: layout width and branding consistency](phase-9-ux-ui-polish/issue-60-visual-design-pass/README.md)
5. [Issue #61 — Investigate ambiguous loading vs. empty states](phase-9-ux-ui-polish/issue-61-loading-vs-empty-states/README.md)

## Phase 10 — Cloud-Readiness Practice (Local, Free)

See `docs/ROADMAP.md` Phase 10. Both feature issues are done — this
phase's blog is complete.

1. [Issue #65 — Install ingress-nginx via Helm](phase-10-cloud-readiness-practice/issue-65-helm-ingress-nginx/README.md)
2. [Issue #66 — LocalStack IAM policy validation & Secrets Manager integration](phase-10-cloud-readiness-practice/issue-66-localstack-iam-secrets-manager/README.md)

## Phase 11 — Integrated Prototype: LocalStack Secrets & IAM in kind

See `docs/ROADMAP.md` Phase 11. All three feature issues are done — this
phase's blog is complete.

1. [Issue #78 — Deploy LocalStack (IAM + Secrets Manager) into the kind cluster](phase-11-integrated-prototype/issue-78-localstack-in-kind/README.md)
2. [Issue #79 — Wire api's boot path to fetch real secrets via an assumed IAM role](phase-11-integrated-prototype/issue-79-secrets-boot-wiring/README.md)
3. [Issue #80 — End-to-end verification: redeploy with LocalStack-backed secrets, re-run the golden path](phase-11-integrated-prototype/issue-80-e2e-verification/README.md)

## Phase 12 — Local CD & Cluster Observability

See `docs/ROADMAP.md` Phase 12. All four feature issues are done — this
phase's blog is complete. Issue #99 wasn't part of the original
planning batch; it was filed mid-phase and is included here alongside
the three that were.

1. [Issue #88 — Register a self-hosted GitHub Actions runner (on-demand mode)](phase-12-local-cd-cluster-observability/issue-88-self-hosted-runner/README.md)
2. [Issue #89 — CD workflow: redeploy kind on push to main](phase-12-local-cd-cluster-observability/issue-89-cd-workflow/README.md)
3. [Issue #90 — k9s + metrics-server for local cluster monitoring](phase-12-local-cd-cluster-observability/issue-90-k9s-metrics-server/README.md)
4. [Issue #99 — Wire dev-localstack into the CD workflow](phase-12-local-cd-cluster-observability/issue-99-dev-localstack-cd/README.md)

## Phase 13 — Local Infra Hardening & Reproducibility

See `docs/ROADMAP.md` Phase 13. All three feature issues are done —
this phase's blog is complete.

1. [Issue #106 — CI validation for infra/k8s manifests and Dockerfiles](phase-13-local-infra-hardening/issue-106-ci-infra-validation/README.md)
2. [Issue #107 — One-shot local bootstrap script for the full kind environment](phase-13-local-infra-hardening/issue-107-bootstrap-script/README.md)
3. [Issue #108 — Adversarial verification: rebuild the kind cluster from scratch](phase-13-local-infra-hardening/issue-108-adversarial-rebuild/README.md)
