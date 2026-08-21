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

## Phase 14 — Recruiter & Overall Reviews + Moderation Admin UI

See `docs/ROADMAP.md` Phase 14. All four feature issues are done —
this phase's blog is complete.

1. [Issue #125 — RecruiterInteraction + RecruiterRating write path](phase-14-recruiter-overall-reviews-moderation-ui/issue-125-recruiter-rating-write-path/README.md)
2. [Issue #126 — OverallReview write path](phase-14-recruiter-overall-reviews-moderation-ui/issue-126-overall-review-write-path/README.md)
3. [Issue #127 — Wizard steps for recruiter experience + overall review](phase-14-recruiter-overall-reviews-moderation-ui/issue-127-wizard-steps/README.md)
4. [Issue #128 — Moderation admin UI](phase-14-recruiter-overall-reviews-moderation-ui/issue-128-moderation-admin-ui/README.md)

## Phase 15 — Public Company Profile Pages

See `docs/ROADMAP.md` Phase 15. All three feature issues are done —
this phase's blog is complete.

1. [Issue #140 — Company read paths: slug lookup + approved reviews list](phase-15-company-profile-pages/issue-140-company-read-paths/README.md)
2. [Issue #141 — Company profile page (/companies/[slug])](phase-15-company-profile-pages/issue-141-company-profile-page/README.md)
3. [Issue #142 — Entry points: link search, wizard, and analytics to profile pages](phase-15-company-profile-pages/issue-142-profile-page-entry-points/README.md)

## Phase 16 — Candidate Accounts & Auth

See `docs/ROADMAP.md` Phase 16. All four feature issues are done — this
phase's blog is complete.

1. [Issue #144 — Mail foundation (Mailpit, D29)](phase-16-candidate-accounts-auth/issue-144-mail-foundation/README.md)
2. [Issue #145 — Magic-link authentication](phase-16-candidate-accounts-auth/issue-145-magic-link-authentication/README.md)
3. [Issue #146 — Sessions on the write path](phase-16-candidate-accounts-auth/issue-146-sessions-on-write-path/README.md)
4. [Issue #147 — Login/logout UI + wizard integration](phase-16-candidate-accounts-auth/issue-147-login-logout-wizard-integration/README.md)

## Phase 17 — Candidate Self-Service

See `docs/ROADMAP.md` Phase 17. Declared fully done, then reopened
while verifying Phase 24's issue #247 — the same non-linear reopening
precedent Phase 18/20 already set. All four feature issues are done —
this phase's blog is complete.

1. [Issue #149 — My reviews: own submissions grouped by InterviewProcess](phase-17-candidate-self-service/issue-149-my-reviews/README.md)
2. [Issue #150 — Update/Delete under moderation-safe rules](phase-17-candidate-self-service/issue-150-update-delete/README.md)
3. [Issue #151 — GDPR erasure path (D34)](phase-17-candidate-self-service/issue-151-gdpr-erasure/README.md)
4. [Issue #260 — Deleting a process that never went anywhere (D46)](phase-17-candidate-self-service/issue-260-delete-empty-process/README.md)

## Phase 18 — Admin Authentication

See `docs/ROADMAP.md` Phase 18. Both feature issues are done — this
phase's blog is complete. Numbered after Phases 16/17 in planning order
but implemented first, the same non-linear precedent Phase 6/8 already
set.

1. [Issue #159 — Admin auth backend](phase-18-admin-authentication/issue-159-admin-auth-backend/README.md)
2. [Issue #160 — Admin auth frontend](phase-18-admin-authentication/issue-160-admin-auth-frontend/README.md)

## Phase 19 — Content Quality & Synthetic Data

See `docs/ROADMAP.md` Phase 19. Filed alongside Phase 18 from the same
2026-07-20 strategic review, then queued behind Phases 24-35 (planned
and implemented more recently, with a more immediate priority) until a
kickoff brainstorm revisited its three issues' original assumptions in
light of everything shipped in the meantime — Phase 29's fraud-check
reframing, Phase 35's company-moderation gate, Phase 24's round-type
registry, Phase 25/26's bulk submission endpoint. All three feature
issues are now done — this phase's blog is complete.

1. [Issue #162 — Near-duplicate review detection (D64)](phase-19-content-quality-synthetic-data/issue-162-near-duplicate-detection/README.md)
2. [Issue #163 — LLM-assisted moderation triage (D66)](phase-19-content-quality-synthetic-data/issue-163-llm-moderation-triage/README.md)
3. [Issue #164 — Synthetic data generator (D62)](phase-19-content-quality-synthetic-data/issue-164-synthetic-data-generator/README.md)

## Phase 20 — Operational Hardening & Live-Verification Findings (retired, split into 20a–20e)

See `docs/ROADMAP.md`'s Phase 20 stub — this grew into a ~32-issue
catch-all under one epic and was split 2026-08-09 into five narrower
phases below, each keeping its original issue numbers/D-numbers. See
[`phase-20-operational-hardening/README.md`](phase-20-operational-hardening/README.md)
for the same pointer.

### Phase 20a — CD/Infra Disk & Build Hygiene

See `docs/ROADMAP.md` Phase 20a. Not every reopen got its own post;
only ones introducing a real design decision (a new D-number) do.

1. [Issue #215 — Prune stale Docker artifacts after every CD deploy (D35)](phase-20a-cd-infra-disk-build-hygiene/issue-215-cd-artifact-pruning/README.md)
2. [Issue #240 — D35's fix cleaned the wrong disk: pruning the kind node's own containerd store (D43)](phase-20a-cd-infra-disk-build-hygiene/issue-240-kind-node-image-pruning/README.md)

### Phase 20b — Docker → Podman Migration

See `docs/ROADMAP.md` Phase 20b. Unlike 20a/20c/20d/20e, every issue in
this arc got its own post — a clean, self-contained six-issue arc
(D83-D93) with an explicit decision gate at each step.

1. [Issue #496 — Podman for `infra/docker-compose.yml`, scoped deliberately narrow (D83)](phase-20b-docker-podman-migration/issue-496-podman-compose-adoption/README.md)
2. [Issue #539 — The `kind`-on-Podman spike that failed, and why that's not the end of the story (D84)](phase-20b-docker-podman-migration/issue-539-kind-podman-spike-rootless/README.md)
3. [Issue #545 — Rootful fixes two of three, then finds a new gap (D88)](phase-20b-docker-podman-migration/issue-545-kind-podman-rootful-retest/README.md)
4. [Issue #547 — The "platform gap" that was actually a config bug (D89)](phase-20b-docker-podman-migration/issue-547-extraportmappings-root-cause/README.md)
5. [Issue #540 — Migrating `cd.yml` to Podman, then finding three things no spike ever reached (D90, D91)](phase-20b-docker-podman-migration/issue-540-cd-runner-podman-migration/README.md)
6. [Issue #541 — Proving it works absent, then actually removing it (D93)](phase-20b-docker-podman-migration/issue-541-docker-desktop-removal/README.md)

### Phase 20c — Live-Verification Tooling & Data Hygiene

See `docs/ROADMAP.md` Phase 20c. Not every reopen got its own post;
only ones introducing a real design decision (a new D-number) do.

1. [Issue #216 — Full golden-path smoke test (D36)](phase-20c-live-verification-tooling-data-hygiene/issue-216-golden-path-smoke-test/README.md)
2. [Issue #212 — `GET /moderation/queue` isolates each entity type's enrichment (D37)](phase-20c-live-verification-tooling-data-hygiene/issue-212-moderation-queue-race-fix/README.md)
3. [Issue #278 — 415 ghosts in the search index: pruning orphaned OpenSearch company documents (D51)](phase-20c-live-verification-tooling-data-hygiene/issue-278-orphaned-search-docs/README.md)
4. [Issue #312 — Port-forwards that outlive the shell that started them](phase-20c-live-verification-tooling-data-hygiene/issue-312-launchd-port-forwards/README.md)

### Phase 20d — Product/UX Polish from Live Verification

See `docs/ROADMAP.md` Phase 20d. Not every reopen got its own post;
only ones introducing a real design decision (a new D-number) do.

1. [Issue #217 — Honest login-page copy + lock down `POST /companies` (D38)](phase-20d-product-ux-polish-from-live-verification/issue-217-login-copy-company-lockdown/README.md)
2. [Issue #222 — Session cookies need a shared `Domain`, or `web` never sees a real login (D39)](phase-20d-product-ux-polish-from-live-verification/issue-222-session-cookie-domain/README.md)
3. [Issue #347 — Company reviews, grouped by submission (D54)](phase-20d-product-ux-polish-from-live-verification/issue-347-company-reviews-grouping/README.md)
4. [Issue #349 — Labeling `/me`'s process outcome distinctly from moderation status (D55)](phase-20d-product-ux-polish-from-live-verification/issue-349-me-outcome-label/README.md)

### Phase 20e — Config, Secrets & Build Correctness Bugs

See `docs/ROADMAP.md` Phase 20e. Not every reopen got its own post;
only ones introducing a real design decision (a new D-number) do.

1. [Issue #466 — Closing out the last plaintext secrets (D76, D77)](phase-20e-config-secrets-build-correctness-bugs/issue-466-secrets-manager-completion/README.md)

### Phase 20f — Retire Local Test-Database Isolation

See `docs/ROADMAP.md` Phase 20f. Not every reopen got its own post; only
ones introducing a real design decision (a new D-number) do — #573
(README/deployment-guide doc updates) shipped in the same PR as #572 but
isn't listed separately below.

1. [Issue #572 — Retiring local test-DB isolation (D96)](phase-20f-retire-local-test-database-isolation/issue-572-remove-test-db-isolation-guards/README.md)

## Phase 21 — Anonymous Visitor Soft-Gating

See `docs/ROADMAP.md` Phase 21. A deliberate product pivot toward
candidate signup pressure that partially reverses Phase 15's fully-
public design intent — this phase's blog is complete.

1. [Soft-gate company profile & analytics pages (D40)](phase-21-anonymous-visitor-soft-gating/README.md)

## Phase 22 — Visual Design Refresh

See `docs/ROADMAP.md` Phase 22. A mechanical visual-polish pass — not
a redesign — addressing "looks simple but not cool": typography,
depth/surface, and layout width, with color-palette expansion and a
brand mark deliberately scoped out as a second-pass option — this
phase's blog is complete.

1. [Typography, depth/surface, and layout-width pass (D41)](phase-22-visual-design-refresh/README.md)

## Phase 23 — Color System & Brand Mark

See `docs/ROADMAP.md` Phase 23. The two directions deliberately scoped
out of Phase 22 — a formalized `Button` color-variant system and a real
brand mark — closing out all five original UI/UX brainstorm items —
this phase's blog is complete.

1. [Button color variants, focus rings, and a brand mark (D42)](phase-23-color-system-brand-mark/README.md)

## Phase 24 — Round-Type Registry & Rating Field Redesign

See `docs/ROADMAP.md` Phase 24. Planned together with Phases 25-26 in
one pass from a UI/UX brainstorm about round-level rating detail and a
full wizard rewrite, implemented strictly in order. Redesigns what a
round rating and a recruiter rating collect, and introduces a shared
round-type registry — its own scope expanded from 2 to all 8 round
types, plus a new admin-content-gateway phase (27), directly at the
project owner's request before implementation began. All three feature
issues are done — this phase's blog is complete.

1. [Issue #247 — Round rating trait redesign](phase-24-round-type-registry-rating-fields/issue-247-round-rating-trait-redesign/README.md)
2. [Issue #248 — Round-type registry, expanded to all 8 round types (D47)](phase-24-round-type-registry-rating-fields/issue-248-round-type-registry/README.md)
3. [Issue #249 — Recruiter rating field redesign (D48)](phase-24-round-type-registry-rating-fields/issue-249-recruiter-rating-redesign/README.md)

## Phase 25 — Bulk Process Submission API

See `docs/ROADMAP.md` Phase 25. Planned alongside Phases 24/26 in one
pass — the backend counterpart Phase 26's client-side draft wizard
needs before it can submit anything for real. The one feature issue is
done — this phase's blog is complete.

1. [Bulk process-submission endpoint (D49)](phase-25-bulk-process-submission-api/README.md)

## Phase 26 — Client-Side Draft Wizard (Flashcard Navigation)

See `docs/ROADMAP.md` Phase 26. Planned alongside Phases 24/25 in one
pass — replaces the old incremental, immediately-writing wizard with
client-side draft state, free-jump step navigation, and a chronological
review screen wired to Phase 25's bulk endpoint. All three feature
issues are done — this phase's blog is complete.

1. [Issue #253 — Client-side draft state architecture (D50)](phase-26-client-side-draft-wizard/issue-253-draft-state-architecture/README.md)
2. [Issue #254 — Flashcard-style step navigation](phase-26-client-side-draft-wizard/issue-254-flashcard-navigation/README.md)
3. [Issue #255 — Chronological review screen + bulk-submit integration](phase-26-client-side-draft-wizard/issue-255-review-screen-bulk-submit/README.md)

## Phase 27 — Admin Content Gateway (Round-Type Field Options)

See `docs/ROADMAP.md` Phase 27. Filed alongside Phase 24 issue #248,
at the project owner's direction: the round-type registry's
controlled-vocabulary values must be admin-manageable through a UI,
not hardcoded. Issue #248 built the read side only; this phase builds
the write side — an admin CRUD API and UI to add, retire, and reorder
those values. Both feature issues are done — this phase's blog is
complete.

1. [Issue #263 — Admin CRUD API for round_type_field_options](phase-27-admin-content-gateway/issue-263-admin-crud-api/README.md)
2. [Issue #264 — Admin UI page for round-type field options](phase-27-admin-content-gateway/issue-264-admin-ui-page/README.md)

## Phase 28 — Wizard UX Refinements

See `docs/ROADMAP.md` Phase 28. Filed from a batch of live-verification
findings against the Phase 26 wizard: an unfriendly raw validation
error on submit, round ratings requiring an opt-in click per round, no
sequential step navigation, a missing round type, recruiter step
wording/timing issues, no trait tooltips, and a mandatory round title
displayed as "untitled." Reopened once more for issue #301 (a
follow-on found while explaining the wizard's session design: a fixed
1h session expiry with no live re-check could leave a candidate
looking logged-in long after their session actually died). Reopened a
third time for three more follow-ons from live discussion of the
wizard: round traits had no tooltip at all (only recruiter traits did,
issue #286), "Next" could silently skip past adding a round entirely,
and draft validation needed to be genuinely modular plus two new rules
(require at least one round; remind, don't force, on missing
pre/post-interview recruiter touchpoints). Reopened a fourth time to
remove the sidebar's now-redundant "Add a round" control once the
Next-button modal existed, and to reorder/validate the round-type
select. All twelve feature issues are done — this phase's blog is
complete.

1. [Issue #281 — Friendly, actionable validation errors on submit](phase-28-wizard-ux-refinements/issue-281-friendly-validation-errors/README.md)
2. [Issue #282 — Round ratings default to available](phase-28-wizard-ux-refinements/issue-282-default-round-ratings/README.md)
3. [Issue #283 — "Next" button alongside free-jump navigation](phase-28-wizard-ux-refinements/issue-283-next-button-navigation/README.md)
4. [Issue #284 — Adding "Tech Screening" as a round type](phase-28-wizard-ux-refinements/issue-284-tech-screening-round-type/README.md)
5. [Issue #285 — Recruiter step wording + read-only timing](phase-28-wizard-ux-refinements/issue-285-recruiter-wording-readonly-timing/README.md)
6. [Issue #286 — Tooltips for recruiter trait ratings](phase-28-wizard-ux-refinements/issue-286-recruiter-trait-tooltips/README.md)
7. [Issue #287 — Optional round title + "{Type} - {Title}" display](phase-28-wizard-ux-refinements/issue-287-optional-round-title/README.md)
8. [Issue #301 — Warning candidates when their session expires mid-draft](phase-28-wizard-ux-refinements/issue-301-session-expiry-warning/README.md)
9. [Issue #305 — A question-mark button for every trait tooltip](phase-28-wizard-ux-refinements/issue-305-help-tooltip-button/README.md)
10. [Issue #307 — Modular validation, a new hard rule, and a soft reminder](phase-28-wizard-ux-refinements/issue-307-modular-validation-reminders/README.md)
11. [Issue #306 — A modal for the moment "Next" would skip past adding a round](phase-28-wizard-ux-refinements/issue-306-next-button-add-round-modal/README.md)
12. [Issue #319 — One way to add a round, not two](phase-28-wizard-ux-refinements/issue-319-consolidate-round-adding/README.md)

## Phase 29 — Moderator Full Content Visibility & Submission Consistency

See `docs/ROADMAP.md` Phase 29. Filed after the user asked that
moderators be able to see every data point a candidate submitted, not
just highlights, that draft/moderation-queue/candidate-submission field
shapes stay consistent, and that the existing fraud-check rate limit be
verified. Issue #315 expanded mid-implementation, per direct user
feedback, from "surface more round fields" into restructuring the whole
moderation queue to group by submission. Issue #317 was reframed
mid-phase (D52) from a straightforward extension into fixing a real bug
in how the rate limit counted candidate activity. All three feature
issues are done — this phase's blog is complete.

1. [Issue #315 — Moderation queue: full round content + group by submission](phase-29-moderator-full-content-visibility/issue-315-moderation-queue-grouping/README.md)
2. [Issue #316 — Fix `ModerationQueueEntity.roundTitle`'s type](phase-29-moderator-full-content-visibility/issue-316-roundtitle-type-fix/README.md)
3. [Issue #317 — Submission-scoped fraud-check rate limit (D52)](phase-29-moderator-full-content-visibility/issue-317-submission-scoped-rate-limit/README.md)

## Phase 33 — Search-First Landing Page

See `docs/ROADMAP.md` Phase 33. Filed retroactively per the user's
direct request to swap the landing page and wizard — search/browse
becomes the default experience, writing a review becomes an explicit
action reachable from search results, a company's profile page, or
NavBar. This phase's blog is complete.

1. [Swap landing page and wizard; write-a-review reachable from search/profile (D56)](phase-33-search-first-landing-page/README.md)

## Phase 34 — Write-a-Review Flow Refinements

See `docs/ROADMAP.md` Phase 34 and `docs/DECISIONS.md` D57. Filed from
a batch of five direct UI/UX requests following Phase 33's search-first
swap: homogeneous company-list rows, a dedicated `/write-review` route
(replacing the wizard's brief stay at `/search`), a login-gated
`/drafts` page, and a search-failure-triggered "request a new company"
flow. All four feature issues are done — this phase's blog is
complete.

1. [Issue #357 — Homogeneous company-list rows](phase-34-write-a-review-flow-refinements/issue-357-homogeneous-company-rows/README.md)
2. [Issues #358-359 — `/write-review` route + login-gated `/drafts` page (D57)](phase-34-write-a-review-flow-refinements/issue-358-359-write-review-drafts-routes/README.md)
3. [Issue #360 — Search-failure "request a new company" flow](phase-34-write-a-review-flow-refinements/issue-360-create-company-request-flow/README.md)

## Phase 35 — Moderated Company Creation & Moderator Search

See `docs/ROADMAP.md` Phase 35 and `docs/DECISIONS.md` D58/D59. Filed
from direct user feedback on issue #360's create-company-request flow:
`POST /companies` had never been moderation-gated, a real gap against
CLAUDE.md hard constraint #2; separately, the moderation queue had no
search/filter capability at all. All four feature issues are done —
this phase's blog is complete.

1. [Issue #369 — Company creation moves behind moderation (D58)](phase-35-moderated-company-creation-moderator-search/issue-369-company-moderation-gate/README.md)
2. [Issue #370 — New moderation-queue OpenSearch index + fuzzy search endpoint (D59)](phase-35-moderated-company-creation-moderator-search/issue-370-moderation-queue-search/README.md)
3. [Issue #371 — Moderation UI search box + category filter](phase-35-moderated-company-creation-moderator-search/issue-371-moderation-ui-search/README.md)
4. [Issue #372 — Confirmation modal replaces the create-company-request auto-redirect](phase-35-moderated-company-creation-moderator-search/issue-372-confirmation-modal/README.md)

## Phase 38 — Company-Profile-Centric Review Browsing

See `docs/ROADMAP.md` Phase 38. Filed from direct product feedback:
clicking a company anywhere on the landing page opened an inline
"browse reviews" panel on that same page instead of going to the
company's own profile; that panel's filtering capability was merged
into the profile page's existing Reviews section (not a new section)
during planning, per further direct feedback. A pagination bug was
also found via live verification while scoping this work. All three
feature issues are done — this phase's blog is complete.

1. [Issue #423 — Home page & search results navigate straight to the company profile](phase-38-company-profile-centric-review-browsing/issue-423-home-page-navigation/README.md)
2. [Issue #424 — Review filtering merged into the Reviews section](phase-38-company-profile-centric-review-browsing/issue-424-merged-review-filtering/README.md)
3. [Issue #425 — Fix: "Previous" left stale reviews on the company profile page](phase-38-company-profile-centric-review-browsing/issue-425-pagination-bug-fix/README.md)

## Phase 37 — Synthetic Data Seed Rollback (Undo by Run ID)

See `docs/ROADMAP.md` Phase 37. Filed from a direct follow-up question
after using Phase 19 issue #164's `seed-demo-data` generator against
the dev database: there was no way to undo a run short of hand-deleting
rows and diffing OpenSearch. Checking the roadmap's own design against
the actual codebase before implementing surfaced three real gaps
(missing `candidateIds` tracking, a missing `CompanySearchService`
delete method, and a missing `Recruiter`-row step in the FK-safe
deletion order), plus a real bug found during live CLI verification
(`--list` eagerly required unrelated admin/JWT environment variables via
a static `AppModule` import). This phase's blog is complete.

1. [Issue #406 — `seed:demo-data:undo`, manifest tracking, and three prerequisite gaps](phase-37-synthetic-data-seed-rollback/README.md)

## Phase 39 — LLM Auto-Approval for High-Confidence Submissions

See `docs/ROADMAP.md` Phase 39 and `docs/DECISIONS.md` D71/D72. Sketched
from a brainstorm about extracting moderator/ticketing services into
their own microservices (Phase 30-32, D53); its own kickoff brainstorm
(issue #437) settled on a single hard confidence cutoff instead of the
three-tier clean/ambiguous/concerning shape originally sketched. All
four feature issues are done — this phase's blog is complete.

1. [Issue #439 — Confidence score & single-cutoff auto-approve routing](phase-39-llm-auto-approval/issue-439-confidence-score-auto-approve-routing/README.md)
2. [Issue #440 — System-attributed auto-approve path with a dedicated audit table](phase-39-llm-auto-approval/issue-440-system-attributed-audit-trail/README.md)
3. [Issue #441 — Config-driven kill switch for LLM auto-approval](phase-39-llm-auto-approval/issue-441-kill-switch/README.md)
4. [Issue #442 — Reconciliation sweep for stalled moderation triage (24h SLA, D72)](phase-39-llm-auto-approval/issue-442-reconciliation-sweep/README.md)

## Phase 30 — Event-Driven Foundation

See `docs/ROADMAP.md` Phase 30 and `docs/DECISIONS.md` D53. Filed from a
brainstorm about moving toward event-driven microservices — a deliberate
revisit of D12 ("moderation stays in-process, no event bus") for
distributed-systems/microservices practice, not organic load. Deliberately
narrow: a message broker (Redpanda) and a best-effort, after-commit
event-publishing pattern matching D16/D17's "never block the write"
shape — no new deployable service ships in this phase, and the
synchronous moderation write path is unchanged. All three feature issues
plus one ad-hoc fix found in design review are done — this phase's blog
is complete.

1. [Issue #330 — Add Redpanda to local infra (docker-compose + k8s)](phase-30-event-driven-foundation/issue-330-redpanda-infra/README.md)
2. [Issue #331 — Shared event-publishing module + versioned event schema](phase-30-event-driven-foundation/issue-331-event-publishing-module/README.md)
3. [Issue #332 — Wire creation + moderation status-change events for all three moderated entity types](phase-30-event-driven-foundation/issue-332-wire-domain-events/README.md)
4. [Issue #459 — `DomainEventPublisher` reconnect-on-recovery](phase-30-event-driven-foundation/issue-459-reconnect-on-recovery/README.md)

## Phase 31 — Notification Service

See `docs/ROADMAP.md` Phase 31 and `docs/DECISIONS.md` D73/D74/D75/D79.
Filed alongside Phase 30 from the same brainstorm — the lowest-risk of
the two service extractions discussed, proving the whole broker/
consumer/idempotent-side-effect pattern end to end on a real, standalone
microservice for the first time. All three feature issues are done —
this phase's blog is complete.

1. [Issue #334 — `notification-service` skeleton: this project's first standalone microservice](phase-31-notification-service/issue-334-notification-service-skeleton/README.md)
2. [Issue #335 — The first real consumer: `*.created` events → "pending review" email (D74, D75)](phase-31-notification-service/issue-335-created-consumer-pending-review-email/README.md)
3. [Issue #336 — Extending the consumer: `*.status_changed` events → approved/rejected email (D79)](phase-31-notification-service/issue-336-status-changed-consumer-approved-rejected/README.md)

## Phase 32 — Review Analyzer Service

See `docs/ROADMAP.md` Phase 32 and `docs/DECISIONS.md` D81. Filed
alongside Phases 30-31 from the same brainstorm — the second of the two
service extractions discussed, and the harder one: unlike
`notification-service`'s read-only side effect, this one has to change
data `api` owns and trigger `api`'s own auto-approval logic from a
standalone process. All three feature issues are done — this phase's
blog is complete.

1. [Issue #338 — Kickoff brainstorm: how does a standalone verdict get back into `api`? (D81)](phase-32-review-analyzer-service/issue-338-kickoff-brainstorm-writeback-event/README.md)
2. [Issue #339 — `review-analyzer` service skeleton: this project's second standalone microservice](phase-32-review-analyzer-service/issue-339-review-analyzer-service-skeleton/README.md)
3. [Issue #340 — Porting LLM-assisted triage into review-analyzer as an async enrichment (D81)](phase-32-review-analyzer-service/issue-340-async-llm-triage-verdict-consumer/README.md)

## Phase 36 — Moderator Queue SLAs, Assignment & Notifications

See `docs/ROADMAP.md` Phase 36 and `docs/DECISIONS.md` D80. Raised
alongside Phase 35's planning, explicitly parked with no design
decisions until a dedicated planning pass (2026-07-31, epic #484)
resolved three open questions: when the SLA clock starts, how work
gets assigned to a moderator, and how a breach reaches anyone. All
seven feature/docs issues are done — this phase's blog is complete.

1. [Issue #485 — Moderator identity table, replacing the shared admin credential](phase-36-moderator-queue-slas-assignment-notifications/issue-485-moderator-identity-table/README.md)
2. [Issue #486 — SLA deadline + claim fields on `ModerationQueueEntry`](phase-36-moderator-queue-slas-assignment-notifications/issue-486-sla-deadline-claim-fields/README.md)
3. [Issue #487 — Claim/release endpoints + moderation queue UI affordance](phase-36-moderator-queue-slas-assignment-notifications/issue-487-claim-release-endpoints/README.md)
4. [Issue #488 — SLA breach detection job (D72's in-process-`@Cron` precedent, reused)](phase-36-moderator-queue-slas-assignment-notifications/issue-488-sla-breach-detection-job/README.md)
5. [Issue #489 — `notification-service` consumes SLA breach events](phase-36-moderator-queue-slas-assignment-notifications/issue-489-notification-service-sla-breach-email/README.md)
6. [Issue #490 — Queue UI: surface SLA deadline and breach state](phase-36-moderator-queue-slas-assignment-notifications/issue-490-queue-ui-sla-breach-indicator/README.md)
7. [Issue #491 — Docs: resolve D80, update DATA_MODEL/ARCHITECTURE](phase-36-moderator-queue-slas-assignment-notifications/issue-491-d80-docs/README.md)

## Phase 41 — Moderator Queue Priority, Filters & Seed-Data Parity

See `docs/ROADMAP.md` Phase 41. Raised while auditing which backend
features actually have frontend consumption (2026-08-04): Phase 36 had
already added `slaDeadline`/`claimedById` to every queue entry, but the
queue itself still sorted by `createdAt` only and had no filters beyond
the separate, OpenSearch-backed search route. Deliberately scoped to just
the feed/filter work plus the one thing blocking it from being testable
(seed-data parity) — an analytics dashboard and a moderator/candidate
communication loop both came up in the same conversation and were
scoped out to their own future phases instead. All three feature issues
are done — this phase's blog is complete.

1. [Issue #522 — Moderation queue: server-side filters + SLA-urgency sort](phase-41-moderator-queue-priority-filters-seed-data-parity/issue-522-server-side-filters-sla-sort/README.md)
2. [Issue #523 — Moderation UI: filter controls + urgency-ordered queue view](phase-41-moderator-queue-priority-filters-seed-data-parity/issue-523-moderation-ui-filter-controls/README.md)
3. [Issue #524 — seed-demo-data: simulate moderator claims and vary flagReason across the full enum](phase-41-moderator-queue-priority-filters-seed-data-parity/issue-524-seed-data-moderator-claims-flag-reasons/README.md)

## Phase 42 — Staff Role Hierarchy & Admin/Moderator Tooling

See `docs/ROADMAP.md` Phase 42 and `docs/DECISIONS.md` D99. Raised from
a direct request to build a real admin > moderator > staff role
hierarchy plus admin/moderator tools — an audit of the actual current
state found `admin-auth`/`ModerationController`/
`AdminRoundTypeFieldOptionsController` all gated by one shared
credential (Phase 36, issue #485), with "admin" and "moderator" the same
undifferentiated actor. D53's "no `moderator-service` extraction" call
was revisited on purpose and reaffirmed for the same reason: this phase
is a role column and some guards, not a service boundary. All eight
issues are done — this phase's blog is complete.

1. [Issue #585 — Kickoff brainstorm: a real role hierarchy instead of one shared credential](phase-42-staff-role-hierarchy-admin-moderator-tooling/issue-585-kickoff-decision-record/README.md)
2. [Issue #586 — Prisma migration: StaffRole, role/isActive/createdById, staff_audit_log](phase-42-staff-role-hierarchy-admin-moderator-tooling/issue-586-staffrole-migration/README.md)
3. [Issue #587 — Permission-set authorization: RequirePermission, PermissionsGuard, role on the staff JWT](phase-42-staff-role-hierarchy-admin-moderator-tooling/issue-587-permission-set-authorization/README.md)
4. [Issue #588 — Migrating ModerationController and AdminRoundTypeFieldOptionsController to permission-based guards](phase-42-staff-role-hierarchy-admin-moderator-tooling/issue-588-migrate-controllers-permission-guards/README.md)
5. [Issue #589 — Staff account management endpoints, self-service password change, audit logging](phase-42-staff-role-hierarchy-admin-moderator-tooling/issue-589-staff-account-management-endpoints/README.md)
6. [Issue #590 — Retiring the shared admin credential for the general case](phase-42-staff-role-hierarchy-admin-moderator-tooling/issue-590-retire-shared-admin-credential/README.md)
7. [Issue #591 — Frontend: role-aware admin panel + staff account management UI](phase-42-staff-role-hierarchy-admin-moderator-tooling/issue-591-frontend-role-aware-admin-panel/README.md)
8. [Issue #592 — seed-demo-data: vary staff/moderator/admin roles across seeded moderators](phase-42-staff-role-hierarchy-admin-moderator-tooling/issue-592-seed-demo-data-varied-roles/README.md)

## Phase 43 — Design System Refresh & Theming

See `docs/ROADMAP.md` Phase 43 and `docs/DECISIONS.md` D100. Raised
from a Frontend SME brainstorm pass (a design-brief artifact covering
tokens, a component gallery, and page mockups) after noticing the app
ran on stock Tailwind `gray-*`/`indigo-600` with no token layer and no
real theme switch — `dark:` classes just mirrored the OS preference.
Direction: a "structured evaluation" visual identity built around this
product's own shape (per-round difficulty, named interviewer traits,
shrinkage-adjusted aggregates that can legitimately be "not enough
data yet"), not a generic SaaS reskin or a comp-transparency tool's
layout borrowed wholesale. All eleven issues are done — this phase's
blog is complete.

1. [Issue #612 — Design tokens & Tailwind foundation: remapping the palette instead of rewriting components](phase-43-design-system-refresh-theming/issue-612-design-tokens-tailwind-foundation/README.md)
2. [Issue #613 — Light/dark/system theme toggle](phase-43-design-system-refresh-theming/issue-613-theme-toggle/README.md)
3. [Issue #614 — Icon system: adopting lucide-react](phase-43-design-system-refresh-theming/issue-614-lucide-icons/README.md)
4. [Issue #615 — Accessible primitives via Radix UI: ConfirmationModal and HelpTooltip](phase-43-design-system-refresh-theming/issue-615-radix-primitives/README.md)
5. [Issue #616 — NavBar redesign: responsive mobile menu](phase-43-design-system-refresh-theming/issue-616-navbar-redesign/README.md)
6. [Issue #617 — Landing page redesign: hero + card grid](phase-43-design-system-refresh-theming/issue-617-landing-page-redesign/README.md)
7. [Issue #618 — Company profile redesign: hero header, score rings, review cards](phase-43-design-system-refresh-theming/issue-618-company-profile-redesign/README.md)
8. [Issue #619 — Analytics dashboard redesign: stat tiles + magnitude bar chart](phase-43-design-system-refresh-theming/issue-619-analytics-dashboard-redesign/README.md)
9. [Issue #620 — Status vocabulary rollout: a real StatusPill component](phase-43-design-system-refresh-theming/issue-620-status-vocabulary-rollout/README.md)
10. [Issue #621 — Wizard visual pass: completion progress + rated/unrated icons](phase-43-design-system-refresh-theming/issue-621-wizard-visual-pass/README.md)
11. [Issue #622 — Accessibility & responsive audit: two real bugs found and fixed](phase-43-design-system-refresh-theming/issue-622-accessibility-responsive-audit/README.md)

## Phase 44 — Hetzner Cloud: Account Setup & Hardened VM Provisioning

See `docs/ROADMAP.md` Phase 44 and `docs/DECISIONS.md` D101. Filed
retroactively after #501 (Phase 40, Oracle Cloud A1.Flex) sat blocked
on "out of host capacity" for over a week — a Hetzner Cloud VM, stood
up via this repo's first real Terraform, as a parallel low-cost path
that unblocks work now without waiting on Oracle's queue. Not a
replacement for #501, which keeps retrying independently, and not a
change to D11 (AWS remains the Phase 8 production target). All three
issues are done — this phase's blog is complete.

1. [Issue #639 — Provision Hetzner Cloud VM via Terraform (parallel path to #501)](phase-44-hetzner-cloud-account-setup-hardened-vm-provisioning/issue-639-provision-hetzner-vm-terraform/README.md)
2. [Issue #643 — Run terraform apply; verify SSH hardening on the Hetzner VM](phase-44-hetzner-cloud-account-setup-hardened-vm-provisioning/issue-643-terraform-apply-ssh-hardening-verification/README.md)
3. [Issue #651 — Decision record (D101): Hetzner Cloud as a parallel low-cost provisioning path](phase-44-hetzner-cloud-account-setup-hardened-vm-provisioning/issue-651-decision-record-d101-hetzner-parallel-path/README.md)

## Phase 45 — App-Hosting Pilot on Hetzner

See `docs/ROADMAP.md` Phase 45. Deploys this repo's existing
`infra/k8s/base` manifests as a real, reachable instance of the full
stack on Phase 44's Hetzner VM — live at `interviewinsights.fyi`.
Several of this phase's own issues couldn't fully close until Phase 46
resolved its own blocking issues (domain, TLS, image delivery) despite
the lower phase number; see Phase 44's own intro for the precedent.
All six issues are done — this phase's blog is complete.

1. [Issue #645 — Install k3s on the Hetzner pilot VM](phase-45-app-hosting-pilot-hetzner/issue-645-install-k3s/README.md)
2. [Issue #646 — `overlays/hetzner-pilot` kustomize overlay](phase-45-app-hosting-pilot-hetzner/issue-646-hetzner-pilot-overlay/README.md)
3. [Issue #647 — Secrets for the pilot environment (D102, Pattern B)](phase-45-app-hosting-pilot-hetzner/issue-647-pilot-secrets-pattern-b/README.md)
4. [Issue #655 — Real SMTP relay, replacing Mailpit (Brevo)](phase-45-app-hosting-pilot-hetzner/issue-655-real-smtp-relay-brevo/README.md)
5. [Issue #648 — Deploy `overlays/hetzner-pilot`; verify full-stack health end to end](phase-45-app-hosting-pilot-hetzner/issue-648-deploy-verify-full-stack-health/README.md)
6. [Issue #649 — Runbook: Hetzner pilot deploy, recovery, and teardown](phase-45-app-hosting-pilot-hetzner/issue-649-deploy-recovery-teardown-runbook/README.md)

## Phase 46 — Hetzner Pilot: Reachability & Operational Hardening

See `docs/ROADMAP.md` Phase 46 and `docs/DECISIONS.md` D103/D108/D109/
D110/D111. Surfaced while working #647 (Phase 45): getting `api`/`web`
actually reachable over the real internet needs a domain, an open
firewall, TLS, a way for images to reach a VM that isn't the CI
runner's own machine, and operational safeguards `dev`/`staging`/`prod`
never needed. Despite the lower phase number, several of Phase 45's own
issues couldn't fully close until this phase's own issues resolved
theirs — see Phase 44's intro for the precedent. All thirteen issues
are done — this phase's blog is complete.

1. [Issue #658 — Decide the pilot's public domain and create DNS records](phase-46-hetzner-pilot-reachability-operational-hardening/issue-658-domain-dns/README.md)
2. [Issue #659 — Open ports 80/443 in the Hetzner Cloud Firewall](phase-46-hetzner-pilot-reachability-operational-hardening/issue-659-firewall-ports/README.md)
3. [Issue #660 — Container image delivery path to the pilot VM (GHCR)](phase-46-hetzner-pilot-reachability-operational-hardening/issue-660-image-delivery-ghcr/README.md)
4. [Issue #661 — Install `ingress-nginx` on the k3s cluster (D108)](phase-46-hetzner-pilot-reachability-operational-hardening/issue-661-ingress-nginx/README.md)
5. [Issue #662 — TLS via cert-manager + Let's Encrypt](phase-46-hetzner-pilot-reachability-operational-hardening/issue-662-tls-cert-manager/README.md)
6. [Issue #665 — Decide the deploy pipeline to the pilot](phase-46-hetzner-pilot-reachability-operational-hardening/issue-665-deploy-pipeline-decision/README.md)
7. [Issue #708 — Build `cd-hetzner.yml` (D105)](phase-46-hetzner-pilot-reachability-operational-hardening/issue-708-cd-hetzner-workflow/README.md)
8. [Issue #761 — `web` image build segfaults under QEMU cross-arch emulation (D109/D110/D111)](phase-46-hetzner-pilot-reachability-operational-hardening/issue-761-web-github-hosted-builder/README.md)
9. [Issue #663 — Postgres backup strategy, with a proven restore path](phase-46-hetzner-pilot-reachability-operational-hardening/issue-663-postgres-backup-restore/README.md)
10. [Issue #664 — Guardrail against `seed-demo-data`/`seed-demo-data-undo` on the pilot](phase-46-hetzner-pilot-reachability-operational-hardening/issue-664-seed-guardrail/README.md)
11. [Issue #666 — k3s upgrade/patch cadence for the pilot VM](phase-46-hetzner-pilot-reachability-operational-hardening/issue-666-k3s-upgrade-cadence/README.md)
12. [Issue #667 — Disk-usage monitoring for the pilot VM](phase-46-hetzner-pilot-reachability-operational-hardening/issue-667-disk-monitoring/README.md)
13. [Issue #668 — Kubeconfig and access control for the pilot cluster](phase-46-hetzner-pilot-reachability-operational-hardening/issue-668-kubeconfig-access/README.md)

## Phase 47 — Moderation Queue Correctness Hardening

See `docs/ROADMAP.md` Phase 47 and `docs/DECISIONS.md` D104. Filed from
an end-to-end audit of the notification/communication chains: a
read-then-write race in `ModerationService.review()`/`claim()`/
`release()` (no lock held between the check and the write) could let two
concurrent moderator actions on the same queue entry both commit.

1. [Issue #674 — Fix the TOCTOU race in `ModerationService.review()`](phase-47-moderation-queue-correctness-hardening/issue-674-review-toctou-fix/README.md)
2. [Issue #675 — Fix the same TOCTOU race in `claim()`/`release()`](phase-47-moderation-queue-correctness-hardening/issue-675-claim-release-toctou-fix/README.md)
3. [Issue #676 — Real-Postgres regression coverage for concurrent moderation actions](phase-47-moderation-queue-correctness-hardening/issue-676-concurrent-regression-tests/README.md)

## Phase 48 — Candidate Password Authentication

See `docs/ROADMAP.md` Phase 48 and `docs/DECISIONS.md` D104. Candidates
were the only actor left on magic-link-only auth; this brings them to
parity with admin-auth's password + bcrypt pattern and makes it the
primary `/login` flow, with the magic link demoted to a secondary option.

1. [Issue #679 — Candidate schema migration for password auth](phase-48-candidate-password-authentication/issue-679-candidate-schema-migration/README.md)
2. [Issue #680 — Password registration + verification email](phase-48-candidate-password-authentication/issue-680-register-verification-email/README.md)
3. [Issue #681 — Password login + `CandidateLoginThrottleGuard`](phase-48-candidate-password-authentication/issue-681-login-throttle/README.md)
4. [Issue #682 — Password reset](phase-48-candidate-password-authentication/issue-682-password-reset/README.md)
5. [Issue #683 — Retire magic-link as primary login; update the frontend](phase-48-candidate-password-authentication/issue-683-retire-magic-link-frontend/README.md)

## Phase 49 — Resubmission Loop & Rejection Feedback

See `docs/ROADMAP.md` Phase 49 and `docs/DECISIONS.md` D104/D106. Filed
from the same end-to-end notification/communication-chain audit as
Phase 47: a confirmed bug in `NotificationLog`'s idempotency key meant a
candidate was never notified of any review decision after the first one
on a given entity, candidates could edit a rejected/flagged submission
indefinitely with no lifetime cap, and `EditThrottleService`'s in-memory
throttle wouldn't coordinate across `api` replicas. This phase activates
D99's parked "candidate-communication-loop" idea.

1. [Issue #686 — Add `moderationQueueEntryId` to `*.status_changed.v1` events](phase-49-resubmission-loop-rejection-feedback/issue-686-moderation-queue-entry-id-status-changed/README.md)
2. [Issue #687 — Fix `NotificationLog`'s idempotency key](phase-49-resubmission-loop-rejection-feedback/issue-687-notification-log-dedup-key-fix/README.md)
3. [Issue #711 — `notification-service` reconciliation sweep](phase-49-resubmission-loop-rejection-feedback/issue-711-notification-reconciliation-sweep/README.md)
4. [Issue #688 — `rejectionReasonCategory` + `reviewNote` on `ModerationActionDto`](phase-49-resubmission-loop-rejection-feedback/issue-688-rejection-reason-review-note/README.md)
5. [Issue #689 — Lifetime resubmission cap + escalation](phase-49-resubmission-loop-rejection-feedback/issue-689-lifetime-resubmission-cap-escalation/README.md)
6. [Issue #690 — New `permanently_rejected` terminal status](phase-49-resubmission-loop-rejection-feedback/issue-690-permanently-rejected-terminal-status/README.md)
7. [Issue #691 — Surface prior-submission history in the moderator queue UI](phase-49-resubmission-loop-rejection-feedback/issue-691-prior-submission-history-ui/README.md)
8. [Issue #692 — Publish a resubmission-ack event on `reenqueue()`](phase-49-resubmission-loop-rejection-feedback/issue-692-resubmission-ack-event/README.md)
9. [Issue #693 — Move `EditThrottleService` off in-memory storage](phase-49-resubmission-loop-rejection-feedback/issue-693-edit-throttle-postgres/README.md)

## Phase 50 — Company Creation Request Lifecycle

See `docs/ROADMAP.md` Phase 50 and `docs/DECISIONS.md` D104/D107. Filed
from the same audit: a rejected company creation request permanently
occupied its slug with no recovery path, and generated zero notification
on submit/approve/reject. Scoped to a pragmatic partial-unique-index fix
rather than a full `CompanyCreationRequest`/`Company` entity split — D104
covers why.

1. [Issue #696 — `candidateId` FK on `Company` + partial unique index on `slug`](phase-50-company-creation-request-lifecycle/issue-696-candidate-id-partial-slug-unique/README.md)
2. [Issue #697 — PATCH edit endpoint for a candidate's own company request](phase-50-company-creation-request-lifecycle/issue-697-company-patch-edit-endpoint/README.md)
3. [Issue #698 — `company.created.v1`/`company.status_changed.v1` events + `notification-service` consumption](phase-50-company-creation-request-lifecycle/issue-698-company-events-notification-consumption/README.md)

## Phase 51 — Staff/Admin/Moderator Notification Platform

See `docs/ROADMAP.md` Phase 51 and `docs/DECISIONS.md` D104. Filed from
the same audit: `StaffAccountsService`'s five mutating methods produced
no email, event, or in-app signal to the affected staff member, and an
unclaimed SLA breach notified no one at all. Sequenced last in this
batch so it could reuse Phase 49's event/idempotency conventions rather
than build a third parallel notification scheme.

1. [Issue #701 — `staff.account.*` event schemas](phase-51-staff-admin-moderator-notification-platform/issue-701-staff-account-event-schemas/README.md)
2. [Issue #702 — Publish `staff.*` events from `StaffAccountsService`](phase-51-staff-admin-moderator-notification-platform/issue-702-publish-staff-events/README.md)
3. [Issue #703 — `StaffNotificationRecipientsService`](phase-51-staff-admin-moderator-notification-platform/issue-703-staff-notification-recipients-service/README.md)
4. [Issue #704 — Tiered SLA escalation](phase-51-staff-admin-moderator-notification-platform/issue-704-tiered-sla-escalation/README.md)
5. [Issue #705 — `notification-service` consumer extension + templates for `staff.*` events](phase-51-staff-admin-moderator-notification-platform/issue-705-consumer-templates-staff-events/README.md)

## Phase 52 — Security & Access-Control Hardening

See `docs/ROADMAP.md` Phase 52 and `docs/DECISIONS.md` D112. Filed
2026-08-20 from a six-domain pre-launch audit (security, data
integrity, business logic, infrastructure, frontend, code quality)
commissioned ahead of the lean launch. The security pass found two
endpoints (`rounds`, `recruiter-interactions`) with no auth guard or
ownership check at all — `rounds` isn't even covered by
`moderation_queue`, so unauthenticated free text could reach a public
process page with zero review — plus IP-throttle bypass behind
ingress-nginx, missing security headers, and a handful of smaller
hardening gaps. All six of CLAUDE.md's hard constraints were separately
verified as genuinely enforced in code, not just documented.

1. [Issue #775 — No auth guard on round creation](phase-52-security-access-control-hardening/issue-775-round-creation-auth-guard/README.md)
2. [Issue #776 — No auth guard on recruiter-interaction creation](phase-52-security-access-control-hardening/issue-776-recruiter-interaction-auth-guard/README.md)
3. [Issue #777 — IP-based throttles collapse behind ingress (missing trust proxy)](phase-52-security-access-control-hardening/issue-777-trust-proxy/README.md)
4. [Issue #778 — Add helmet security headers](phase-52-security-access-control-hardening/issue-778-helmet-security-headers/README.md)
5. [Issue #779 — Prisma exception filter can leak internal detail](phase-52-security-access-control-hardening/issue-779-prisma-exception-filter-default-case/README.md)
6. [Issue #780 — No boot-time assertion for COOKIE_SECURE/CORS_ORIGIN](phase-52-security-access-control-hardening/issue-780-cors-cookie-boot-assertions/README.md)
7. [Issue #781 — Raw SQL identifier interpolation in fraud-checks](phase-52-security-access-control-hardening/issue-781-fraud-checks-raw-sql-injection-shape/README.md)
8. [Issue #782 — verdict-consumer doesn't schema-validate Kafka payloads](phase-52-security-access-control-hardening/issue-782-verdict-consumer-schema-validation/README.md)
9. [Issue #783 — Staff email has no documented PII-handling rationale](phase-52-security-access-control-hardening/issue-783-staff-email-pii-rationale/README.md)
10. [Issue #784 — Local dev EMAIL_ENCRYPTION_KEY is a low-entropy placeholder](phase-52-security-access-control-hardening/issue-784-dev-encryption-key-entropy/README.md)

## Phase 53 — Data Integrity, Consistency & Documentation Reconciliation

See `docs/ROADMAP.md` Phase 53 and `docs/DECISIONS.md` D15. Filed from
the same audit: the three analytics materialized views were never
refreshed in production (D15's original refresh-on-read plan never
actually shipped), GDPR erasure FK-violated for any candidate who ever
reset a password or edited a submission, and company creation was the
one write path not wrapped in the same transaction as its moderation
enqueue. Three independent audit passes also each re-derived that
`docs/ARCHITECTURE.md`'s "zero write path" claim for recruiter/overall-
review was stale — folded in as four documentation-only fixes rather
than a seventh epic.

1. [Issue #787 — Analytics materialized views never refreshed in production](phase-53-data-integrity-consistency-documentation-reconciliation/issue-787-materialized-view-refresh/README.md)
2. [Issue #788 — GDPR erasure FK-violates for two candidate tables](phase-53-data-integrity-consistency-documentation-reconciliation/issue-788-gdpr-erasure-fk-fix/README.md)
3. [Issue #789 — Company creation isn't transactional with its moderation enqueue](phase-53-data-integrity-consistency-documentation-reconciliation/issue-789-company-creation-transactional/README.md)
4. [Issue #790 — Fraud-check rate limit is a TOCTOU race (deliberately deferred)](phase-53-data-integrity-consistency-documentation-reconciliation/issue-790-fraud-check-toctou-deferred/README.md)
5. [Issue #791 — Stale "zero write path" claim in docs/ARCHITECTURE.md](phase-53-data-integrity-consistency-documentation-reconciliation/issue-791-architecture-stale-write-path-claim/README.md)
6. [Issue #792 — GDPR erasure listed as an open decision though it's implemented](phase-53-data-integrity-consistency-documentation-reconciliation/issue-792-data-model-gdpr-open-decision-stale/README.md)
7. [Issue #793 — moderation_queue.entity_type list missing 'company'](phase-53-data-integrity-consistency-documentation-reconciliation/issue-793-data-model-entity-type-missing-company/README.md)
8. [Issue #794 — Round-type registry table missing tech_screening](phase-53-data-integrity-consistency-documentation-reconciliation/issue-794-data-model-round-type-registry-missing-tech-screening/README.md)

## Phase 54 — Business-Process Closed-Loop Fixes

See `docs/ROADMAP.md` Phase 54. Filed from the same audit: the
business-logic pass traced every major process end to end looking for
dead ends. Most were genuinely closed loops — the exceptions: SLA
breach/warning notifications were one-shot with no "resolved" signal,
`document_verified` was a schema-ready but structurally unreachable
enum value (no document-upload flow exists), and `staff_audit_log` was
written on every staff mutation but never surfaced anywhere. A fourth
finding — rejected candidates never learn why — was already filed as
issue #729 under Phase 49's own epic before this audit ran; related to
this phase's scope but kept under its original parent per GitHub's
one-parent-per-sub-issue limit, so its post lives here instead.

1. [Issue #797 — SLA breach/warning notifications never signal resolution](phase-54-business-process-closed-loop-fixes/issue-797-sla-resolved-event/README.md)
2. [Issue #798 — candidates.verification_status.document_verified is a dead enum value](phase-54-business-process-closed-loop-fixes/issue-798-dead-document-verified-enum-value/README.md)
3. [Issue #799 — staff_audit_log is written but never surfaced](phase-54-business-process-closed-loop-fixes/issue-799-staff-audit-log-surfaced/README.md)
4. [Issue #729 — Rejected candidates never learn why (Phase 49 follow-up)](phase-54-business-process-closed-loop-fixes/issue-729-candidate-rejection-reason-surfacing/README.md)
