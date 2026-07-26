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

## Phase 20 — Operational Hardening & Live-Verification Findings

See `docs/ROADMAP.md` Phase 20. Filed retroactively — cross-cutting
fixes and tooling discovered via live verification, stress-testing, and
product review rather than planned feature work. Declared fully done,
then reopened six times — for issues #222, #240, #278, #312, #347, and
#349 — the same non-linear precedent Phase 6/8/18 already set. All ten
feature issues are now done — this phase's blog is complete. Phase 19
(Content Quality & Synthetic Data) remains queued behind it.

1. [Issue #215 — Prune stale Docker artifacts after every CD deploy (D35)](phase-20-operational-hardening/issue-215-cd-artifact-pruning/README.md)
2. [Issue #216 — Full golden-path smoke test (D36)](phase-20-operational-hardening/issue-216-golden-path-smoke-test/README.md)
3. [Issue #212 — `GET /moderation/queue` isolates each entity type's enrichment (D37)](phase-20-operational-hardening/issue-212-moderation-queue-race-fix/README.md)
4. [Issue #217 — Honest login-page copy + lock down `POST /companies` (D38)](phase-20-operational-hardening/issue-217-login-copy-company-lockdown/README.md)
5. [Issue #222 — Session cookies need a shared `Domain`, or `web` never sees a real login (D39)](phase-20-operational-hardening/issue-222-session-cookie-domain/README.md)
6. [Issue #240 — D35's fix cleaned the wrong disk: pruning the kind node's own containerd store (D43)](phase-20-operational-hardening/issue-240-kind-node-image-pruning/README.md)
7. [Issue #278 — 415 ghosts in the search index: pruning orphaned OpenSearch company documents (D51)](phase-20-operational-hardening/issue-278-orphaned-search-docs/README.md)
8. [Issue #312 — Port-forwards that outlive the shell that started them](phase-20-operational-hardening/issue-312-launchd-port-forwards/README.md)
9. [Issue #347 — Company reviews, grouped by submission (D54)](phase-20-operational-hardening/issue-347-company-reviews-grouping/README.md)
10. [Issue #349 — Labeling `/me`'s process outcome distinctly from moderation status (D55)](phase-20-operational-hardening/issue-349-me-outcome-label/README.md)

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
