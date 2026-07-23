# Decisions log

Lightweight ADR (architecture decision record) log. Add a new entry whenever
a non-trivial decision gets made — this is what prevents re-litigating the
same question in a future session.

---

### D1 — PostgreSQL as primary data store
**Decision:** Use PostgreSQL, not a document DB, as the system of record.
**Why:** The domain is fundamentally relational — rounds belong to
processes, ratings belong to rounds, aggregates roll up hierarchically.
JSONB columns handle the genuinely flexible parts (round-type-specific
fields) without needing a document model for the whole schema.

### D2 — Interviewers/recruiters never named publicly
**Decision:** Interviewer and recruiter identity is stored internally
(for de-duplication and internal analytics) but never shown by real name
in any public-facing surface. Public label is generated per context
("Interviewer A", "Round 2 recruiter").
**Why:** Naming real individuals in bias/attentiveness/communication
ratings carries real defamation exposure. This is a legal risk mitigation,
not a UX nicety — don't relax it for a feature request without revisiting
the legal reasoning.

### D3 — Moderation gates all public visibility
**Decision:** Every rating/review row starts at `status = pending` and is
only publicly visible once approved. Moderation is a separate service, not
inline logic in the write path.
**Why:** Fraud and fake-review risk is the single biggest threat to this
platform's credibility. Treating it as a bolt-on after launch is much more
expensive than building it in from the start.

### D4 — Public aggregates use shrinkage scoring, not a hard sample-size gate
**Decision:**
```
displayed_score = (n / (n + k)) * company_avg + (k / (n + k)) * global_avg
```
`k` starts at 8–10 (tune once real data exists). Hard floor: never display
any score below `n = 3` (show "not enough reviews yet" instead).
**Why:** A flat cutoff (e.g. "hide below n=5") creates a misleading cliff —
n=4 shows nothing, n=5 shows a raw average that's still barely meaningful.
Shrinkage pulls small samples toward the platform average and converges to
the true average as `n` grows, with no discontinuity and more resistance to
a handful of fake reviews swinging the number.

### D5 — Level/role normalization is phased, not day-one
**Decision:** Store `role_title`/`level` as free text for MVP. Add a
nullable `normalized_band` column (`entry`/`mid`/`senior`/`staff`/
`principal`/`manager`/`director`/`exec`) and a `company_level_mappings`
table later, populated progressively (manual seeding for top companies,
`unmapped` is a valid state — never guess a mapping).
**Why:** Level semantics vary wildly across companies ("L5" means different
things everywhere). Getting the taxonomy wrong up front is worse than not
having it yet — better to learn from real `role_title`/`level` data before
committing to a mapping scheme. Company-specific views keep showing raw
text regardless; `normalized_band` is only used for cross-company
comparison features.

### D6 — Migrations via Prisma
**Decision:** Prisma is the ORM/migration tool.
**Why:** User preference; locked in to avoid retrofitting a different
migration tool onto an existing schema later.

### D7 — Ratings stored as atomic rows, never pre-averaged
**Decision:** No running-average columns anywhere. All aggregates are
computed from raw rating rows (via materialized views / rollup jobs).
**Why:** Keeps recomputation, backfills, and dispute-driven deletions
correct. A pre-averaged column drifts out of sync the moment a row is
edited or removed.

### D8 — One rating per candidate per round/interaction
**Decision:** Unique constraint on `(round_id, candidate_id)` for round
ratings and `(recruiter_interaction_id, candidate_id)` for recruiter
ratings.
**Why:** Prevents a single candidate inflating or deflating a score by
submitting multiple ratings for the same round.

### D9 — Materialized views before a separate OLAP store
**Decision:** Start aggregation with Postgres materialized views. Only
introduce ClickHouse (or similar) once materialized views measurably strain
under load.
**Why:** Avoid premature infrastructure. A second analytics datastore adds
real operational complexity (another system to run, another sync path to
maintain) that isn't justified until there's evidence it's needed.

---

### D10 — NestJS as the API framework
**Decision:** Use NestJS (Node/TypeScript) for the `api` service.
**Why:** User preference. NestJS's opinionated module/controller/service
structure pairs naturally with Prisma (same TS runtime as the rest of the
stack — no cross-language client generation) and gives the API structure
enforced early, which matters once round/rating/moderation endpoints
multiply across Phase 2+.

---

### D11 — AWS as the target cloud provider
**Decision:** AWS is the cloud target for everything in `docs/ROADMAP.md`
Phase 8 (CI/CD, secrets, networking, IAM, caching, observability). ECS
Fargate or EKS for compute, Secrets Manager for secrets, ElastiCache for
Redis, CloudWatch/X-Ray for logs/traces, IAM Identity Center for human access.
**Why:** Most mature ecosystem for this exact shape of stack (containerized
Node services + Postgres + Kafka-compatible bus), the deepest bench of
docs/examples for pairing GitHub Actions with OIDC-federated deploys, and no
existing organizational lock-in to Azure/GCP that would override the default.
**Not yet decided:** none of Phase 8 is built — this only fixes which cloud
to target *when* each item's trigger condition is met, so the eventual build
doesn't re-litigate the provider choice piecemeal.

---

### D12 — Moderation runs in-process, not as a separate worker/Kafka consumer
**Decision:** Phase 3's moderation queue (GitHub issue #1) is a NestJS module
inside `api` — enqueuing a `moderation_queue` row happens in the same DB
transaction as the rating/review write, and review actions
(`POST /moderation/queue/:id/{approve,reject,flag}`) run synchronously
against Postgres. No `workers` process, no Redpanda/Kafka consumer.
**Why:** `docs/ARCHITECTURE.md` describes moderation as event-driven off the
Kafka/Redpanda bus, but nothing in the app produces to that bus yet (it was
removed from local `docker-compose.yml` entirely — see D9). Standing up a
consumer for a queue nothing populates would be exactly the premature
infrastructure D9 warns against. Enqueuing is a single fast insert, so doing
it inline doesn't reintroduce the "slow inline check" problem the
event-driven design is meant to avoid — that concern is about fraud/ML
*scoring* (Phase 3 issue #2, still unbuilt), not the enqueue step itself.
**Revisit when:** there's a second consumer of the same write events (e.g.
Phase 4's aggregation worker) or actual throughput that benefits from
decoupling the write path from moderation — at that point both would move
onto the same Kafka/Redpanda-backed `workers` process together, per
`docs/ROADMAP.md` Phase 8g.

---

### D13 — Fraud checks flag, never reject, and duplicate detection is exact-match only
**Decision:** Phase 3 issue #2's rate-limiting and duplicate-text checks
(`FraudChecksService`) never block a write. A rating that trips either check
is still created as `pending` like any other (CLAUDE.md hard constraint #2
says every write starts pending, no carve-out for suspicious ones) — the
only effect is its `moderation_queue` row gets a `flagReason`
(`rate_limit`/`duplicate`) so a human reviewer sees why it's suspicious.
Duplicate detection is exact-match after normalizing whitespace/case, via a
full-table scan-and-compare in application code — not fuzzy/near-duplicate
matching, and not backed by an index.
**Why:** A hard reject risks blocking a legitimate candidate (e.g.
interviewing for multiple roles the same week, or two candidates
independently writing similar short reviews) with no recourse, which
undermines trust worse than a false negative would. The schema's
`flag_reason` enum already models this as a moderation signal, not a
gate — see docs/DATA_MODEL.md. The full-table-scan approach is a
`docs/DECISIONS.md` D9-style honest MVP: correct at today's data volume,
not something that scales.
**Revisit when:** real volume makes the full-table scan slow (add a Postgres
trigram index, or move to the OpenSearch layer in `docs/ROADMAP.md` Phase
5), or false negatives/positives from exact-match-only duplicate detection
turn out to matter in practice (add fuzzy matching then, not before).

---

### D14 — Candidate verification token is returned directly, not emailed
**Decision:** Phase 3 issue #3's `POST /candidates/:id/verification-token`
returns the raw token in the response body. `POST /candidates/verify`
consumes it and flips `verificationStatus` to `email_verified`. The token is
single-use (`consumedAt`) and issuing a new one supersedes any still-valid
token for that candidate. No email is actually sent.
**Why:** There's no email-sending integration anywhere in this codebase yet,
and building one is a distinct, non-trivial workstream (provider choice,
templates, deliverability) out of scope for "the verification flow exists
and works." Returning the token directly keeps the flow fully testable
end-to-end today. This is a real, if temporary, security gap: anyone who
can call the API on a candidate's behalf can verify them without proving
email ownership — acceptable for pre-launch development, not for real
candidate data.
**Revisit when:** before any real (non-test) candidate data flows through
this — swap the response for "sent" and wire an actual email provider,
without changing the token/consumption model underneath.

---

### D15 — Aggregation materialized views have no refresh trigger yet
**Decision:** The three materialized views from `docs/DATA_MODEL.md`
(`company_round_type_aggregates`, `company_recruiter_aggregates`,
`company_overall_aggregates`), added in Phase 4 issue #7, only reflect data
as of migration time or the last manual `REFRESH MATERIALIZED VIEW` call —
nothing refreshes them automatically yet. Each has a unique index on its
grain columns so a future `REFRESH ... CONCURRENTLY` won't lock readers out.
**Why:** Issue #7 is scoped to "the views exist and compute correctly, from
approved rows only" — deciding *when* to refresh belongs with whatever
actually reads them, so it's deferred to issue #9 (the analytics endpoint)
rather than guessed at here.
**Revisit when:** issue #9 is implemented — refresh-on-read is the likely
starting point (simplest, correct, fine at today's volume); an
event-driven refresh (Kafka consumer on approved-rating events) only
becomes worth it once on-read refresh measurably strains, per the same D9
reasoning already applied to moderation (D12) and fraud checks (D13).

---

### D16 — Company search indexing is synchronous, in-process, and best-effort
**Decision:** Phase 5 issue #21 indexes a company into OpenSearch
synchronously, right after the Postgres write, inside `CompaniesService
.create()` — not via a Kafka/Redpanda event. Unlike D12's moderation
enqueue (which happens in the *same transaction* as the write, so a
failure there fails the whole write), search indexing is wrapped in its
own try/catch: a failure to index is logged and swallowed, never thrown
back to the caller. The company row in Postgres is created either way.
**Why:** Same "nothing else produces to Redpanda yet" reasoning as
D12/D13 — a Kafka consumer for company-creation events would be premature
infrastructure (D9) with only one consumer (this index) to justify it. The
best-effort (not transactional) framing is new here though: OpenSearch is
explicitly a derived, secondary store per `docs/ARCHITECTURE.md` ("Search
is separate from the primary store"), not the source of truth the way
`moderation_queue` effectively is for moderation state — so it shouldn't
be allowed to block or fail the primary write the way an in-transaction
failure would. Also fixed a real concurrency bug hit while building this:
`CompanySearchService.onModuleInit()` originally did a check-then-act
(`indices.exists` then `indices.create`), which races when multiple app
instances start concurrently (multiple Jest workers in tests; multiple
replicas in a real deployment) — fixed by always attempting creation and
swallowing the resulting `resource_already_exists_exception`.
**Revisit when:** there's a second consumer of company-creation events
(e.g. a future audit log or notification), or indexing latency becomes
observable enough in the request path to matter — at that point, move to
an event-driven path per the same Phase 8g framing as D12/D13.

---

### D17 — Review search indexing runs from `ModerationService.review()`, after commit
**Decision:** Phase 5 issue #22 indexes an approved `round_rating` into the
`reviews` OpenSearch index from inside `ModerationService`'s existing
`review()` method — after the DB transaction that flips its status to
`approved` commits, not inside it. Same best-effort framing as D16 (logged,
swallowed, never fails the moderation decision, which is already committed
by the time indexing runs). Only a `decision === 'approved'` triggers
indexing; `rejected`/`flagged` never index anything, and nothing removes a
document once indexed (there's no un-approve path in the current model).
**Why:** Extends D16's reasoning to a second index. Indexing after commit
(not inside the transaction) is deliberate: the transaction's only job is
the atomic queue-entry + rating-status update; search indexing needs a
separate read (`round_rating` joined through `round` → `process` for
`companyId`/`roleTitle`) that has no business holding that transaction
open, and a failure to index must not roll back an already-decided
moderation outcome.
**Found while building this:** a real relevance bug in `CompanySearchService`
(D16) — `fuzziness: 'AUTO'` let two long numeric tokens a few digits apart
(e.g. two `Date.now()`-based test identifiers) fuzzy-match each other,
surfacing as an apparently flaky e2e test that was actually a deterministic
false-positive match. Removed fuzziness from that query. Also bumped
`test/jest-e2e.json`'s `testTimeout` to 30s (from Jest's 5s default) — e2e
`beforeAll` hooks boot a full Nest app plus connections to Postgres *and*
OpenSearch, which measurably exceeded 5s under heavy repeated local test
runs.
**Revisit when:** same trigger as D16 — a second consumer of approved-review
events, or indexing latency becomes observable enough to matter.

---

### D18 — Scripted `gh`/git commands with backtick-containing bodies use `--body-file`, never a heredoc nested inside `$(...)`
**Decision:** Any script that generates a multi-line `gh issue create` /
`gh pr create` (or similar) body containing backticks writes that body to
its own file first and passes it via `--body-file <path>` — never via
`--body "$(cat <<'EOF' ... EOF)"`.
**Why:** Hit a real, silent bug scripting the creation of one tracking
issue per phase (linking each phase's `wiki/blog/` post to its feature
branches). macOS's default bash (3.2.57) mis-parses backticks inside a
heredoc that's itself nested inside `$(...)` command substitution — even
with the heredoc delimiter quoted (`<<'EOF'`), which is supposed to
suppress *all* expansion inside the heredoc body, backtick pairs included.
In practice, some backtick-quoted substrings (e.g. `` `blog-phase-1-foundation` ``)
were interpreted as command substitutions, executed as literal shell
commands (failing with "command not found"), and silently stripped from
the resulting issue body — corrupting the output without the script
itself stopping, since the failures happened inside a subshell and
`set -e` doesn't propagate an error from within a command substitution
the way it does from a top-level command. This created two visibly
garbled issues (duplicate "Phase 1" tracking issues, both missing chunks
of their intended body) before being caught from the stray `command not
found` output and deleted. Writing the body to a real file and passing
`--body-file` sidesteps the whole nested-heredoc-in-command-substitution
interaction — there's no quoting ambiguity left to get wrong.
**Revisit when:** never — this is a permanent scripting habit, not a
temporary workaround for one bash version. A newer bash (e.g. via
Homebrew) might not reproduce this specific parsing bug, but
`--body-file` is strictly safer regardless and costs nothing extra, so
there's no reason to special-case it by shell version.

---

### D19 — Helm for third-party infra only; our own app manifests stay on Kustomize
**Decision:** `ingress-nginx` (Phase 7 issue #28) is now installed via
`helm install ingress-nginx ingress-nginx/ingress-nginx`, not the raw
upstream `kubectl apply -f .../deploy.yaml` it started with. This is
scoped narrowly: Helm is adopted for *third-party* infrastructure
components — anything the wider ecosystem distributes primarily as a
chart (`ingress-nginx`, and later likely `cert-manager`,
`prometheus`/`grafana`) — not for `interview-insights`' own `api`/`web`/
`postgres`/`opensearch` manifests, which stay exactly as Kustomize-managed
as they were after issue #29.
**Why:** the Helm-trigger note already in `docs/ROADMAP.md` Phase 7 is
correct and still holds for our *own* manifests — 2 app services and 2
stateful deps aren't "genuinely repetitive" and issue #29's Kustomize
overlays already solve the per-environment duplication problem Helm
would otherwise address. But that reasoning was never about third-party
components at all — those are versioned, packaged, and upgraded by their
own maintainers specifically as Helm charts, and `helm upgrade`/
`helm rollback` are the tools built for tracking someone else's release
cadence safely. Migrating `ingress-nginx` proved the two tools coexist
cleanly in the same cluster without conflict: Kustomize's `dev` overlay
re-applies cleanly after the Helm-managed controller replaced the manual
one, and the full app is reachable through it with zero regression
(verified via the same Playwright golden-path check used throughout this
project).
**Revisit when:** our own manifests actually become repetitive enough to
retrigger the original Helm note (unlikely soon) — that would be a
separate decision from this one, not an extension of it.

### D20 — LocalStack practice is local-only and does not change D11
**Decision:** LocalStack is used locally (free/Hobby tier) to validate
IAM policy JSON and to build a `SecretsProvider` integration path in
`api` that can fetch secrets from a Secrets Manager-shaped API — neither
is wired into any actually-deployed path (`docker-compose`'s full
profile and the k8s manifests keep reading secrets from plain env vars/
a k8s `Secret`, unchanged). Confirmed directly from LocalStack's own docs
before starting: EKS cluster emulation requires the Ultimate plan
($89/month) — "Free/Base/Pro tiers are not supported" — so `kind` remains
the compute layer regardless; only the lighter AWS services (IAM,
Secrets Manager, S3, etc.) are actually free to use this way.
**Why:** this lets Phase 8b (secrets)/8d (IAM) integration code get
written and tested for $0 and with zero real-account risk, without
either sub-area's trigger actually firing — the same "zero-maintenance
dry run" carve-out already noted on 8d's own bullet in
`docs/ROADMAP.md`, just extended to Secrets Manager too. **D11 (AWS as
target cloud) is unchanged** — this work doesn't require picking AWS
over OCI or vice versa, since nothing here touches a real account of
either; that decision is still deferred to the day a real, live,
internet-reachable deployment is actually wanted.
**Revisit when:** a real Phase 8b or 8d trigger fires — at that point,
the actual cloud provider decision (real AWS EKS cost vs. OCI/OKE
free-forever) has to be made for real, and this LocalStack-tested
integration code is what gets wired into the real deployed path.

**Found while building this:** two real limitations, neither assumed —
both confirmed directly before working around them.
- **LocalStack now requires a free-account auth token
  (`LOCALSTACK_AUTH_TOKEN`) just to start the container at all**, even
  for community/non-commercial use of free services like IAM and
  Secrets Manager — a 2026 packaging change, not something specific to
  this project ("we will only support one single image for LocalStack
  for AWS via Docker Hub, which will require a user account and an auth
  token to run," per LocalStack's own announcement). `docker compose`
  doesn't forward host env vars into a container automatically either —
  `infra/docker-compose.yml`'s `localstack` service has to explicitly
  declare `LOCALSTACK_AUTH_TOKEN: ${LOCALSTACK_AUTH_TOKEN:?...}` to read
  it from the host shell, with a clear failure message if it's unset,
  rather than silently starting without it and crash-looping on a vague
  license error.
- **IAM policy *simulation* isn't reliably emulated, only policy CRUD
  is.** `iam simulate-custom-policy` fails outright ("not currently
  supported by LocalStack"); `iam simulate-principal-policy` runs
  without error but returns `explicitDeny` unconditionally regardless of
  the actual policy content — i.e. it doesn't evaluate anything. Confirmed
  by testing both directly, not assumed from docs. `infra/aws/
  verify-iam-policy.sh` combines two checks instead: LocalStack's real
  `create-policy` call proves the JSON is syntactically valid IAM policy
  language (catches the kind of structural typo real IAM would also
  reject); a plain structural check on the parsed JSON proves the
  *semantic* properties (exactly one read-only action, no bare `"*"`
  resource) that simulation would otherwise be the natural tool for.

---

### D21 — `<form action={fn}>`'s pre-await state updates don't flush immediately; use `onSubmit` when an in-flight indicator matters
**Decision:** `web/src/app/search/page.tsx`'s two search forms use plain
`onSubmit={fn}` handlers (`event.preventDefault()` + `new
FormData(event.currentTarget)`), not React 19's `<form action={fn}>`
pattern used elsewhere in this app (e.g. `web/src/app/page.tsx`'s wizard
forms).
**Why:** found while fixing GitHub issue #61 (Phase 9). A `setState` call
made *before* the first `await` inside a function passed to `<form
action={fn}>` does not flush to the DOM until some `await` inside that
same function resolves — confirmed directly, in both a Testing Library
unit test and a real browser against a deliberately delayed API response,
not assumed from a framework changelog. Concretely: `setCompanySearching
(true)` called as the first line of `handleCompanySearch`, before
`await api.searchCompanies(q)`, never rendered — the UI stayed on
whatever it showed before the click, with no visible feedback that a
search was running. The same "set a flag, then await" shape *did* work
correctly elsewhere in this app (`web/src/app/page.tsx`'s `setRating(...)`
followed later by `await api.listApprovedRatingsForRound(...)` — see
`approvedRatings === null` in that file) — the difference is that
`setRating` happens *after* the call's own first `await` already
resolved, not before it. Switching the search forms to plain `onSubmit`
handlers sidesteps this entirely: a normal DOM event handler's `setState`
calls flush the same way any click handler's do, with no dependency on
React's action/transition batching semantics.
**Revisit when:** never, really — this is now the standing rule for any
future form in this app that needs to show an in-flight state before its
own first `await`. `<form action={fn}>` remains fine (and is unchanged
elsewhere in this app) for forms that only need to show state *after*
an await resolves, or that don't need an in-flight indicator at all.

---

### D22 — LocalStack secrets/IAM now back a real deployed path (locally); still not a Phase 8 substitute
**Decision:** Phase 11 (issues #78-#80) wires D20's practice-only
LocalStack integration into the local `kind` cluster for real: `api`'s
pod assumes an IAM role via STS and fetches `DATABASE_URL`/
`EMAIL_HASH_SECRET` from LocalStack Secrets Manager at boot, opt-in via
`SECRETS_SOURCE=localstack` (only set by `infra/k8s/overlays/
dev-localstack`'s patch — `docker-compose` and the plain `dev` overlay
are unchanged). This is D20's own "Revisit when: a real Phase 8b or 8d
trigger fires" — except the trigger here was the user explicitly asking
for one running environment where every tool built so far (Helm,
Kustomize, Postgres, OpenSearch, search, moderation, analytics, and now
secrets/IAM) genuinely communicates together, not a real production
need. Also fixed a real bug found by this phase's own adversarial
verification (issue #80): the api container's `CMD` ran `npx prisma
migrate deploy` as its own shell step *before* `node dist/main.js`,
reading `DATABASE_URL` straight from the OS environment — invisible to
`main.ts`'s in-process secrets bootstrap, since that mutation happens in
a different, not-yet-started process. Migrations were silently still
keyed off the plaintext k8s Secret the whole time; only the app's own
runtime queries used the LocalStack-fetched value. Fixed with
`api/scripts/entrypoint.js`, which runs the bootstrap exactly once and
spawns both the migration and the app from the same (correctly mutated)
`process.env`.
**Why:** proving "wired" and "actually used, everywhere it matters" are
different claims — issue #79's own verification (creating a candidate
and comparing the stored `email_hash` against each possible secret)
already proved the app's runtime path was correct, but didn't touch the
migration step at all, so the gap survived one full issue undetected.
Issue #80 closed it by being adversarial on purpose: corrupting the
plaintext `api-secrets` k8s Secret with obviously-wrong values and
confirming the pod still boots and behaves correctly without it — which
only started passing once the entrypoint fix landed.
**Known boundary, unchanged from D20:** LocalStack's free tier still
doesn't evaluate IAM policies (confirmed again in `seed-localstack.sh`'s
own verification step, which proves the AssumeRole → temporary-
credentials → `GetSecretValue` chain works, not that the attached policy
is what's gating it) and still doesn't emulate EKS. This stays a local,
free prototype — it does not retrigger D11 (AWS provider choice) or
start Phase 8 for real; that remains gated on an actual production
trigger, per Phase 8's own intro in `docs/ROADMAP.md`.
**Revisit when:** a real Phase 8b/8d trigger fires against a real AWS
account — at that point the same `bootstrapSecretsFromLocalStack`/
`entrypoint.js` shape (assume role, fetch secrets, mutate env before
migrate + app both start) is what gets pointed at real AWS Secrets
Manager/IAM instead of LocalStack, per D20's original framing.

---

### D23 — CD's default deploy target flips to `dev-localstack`; still not a Phase 8 substitute
**Decision:** GitHub issue #99 (Phase 12) changes `.github/workflows/
cd.yml` to apply `infra/k8s/overlays/dev-localstack` on every push to
`main`, not the plain `dev` overlay D22 described as CD's target.
Concretely reverses D22's "opt-in... `docker-compose` and the plain
`dev` overlay are unchanged" framing: every automatic local redeploy now
provisions the `localstack-credentials` Secret (from a new
`LOCALSTACK_AUTH_TOKEN` GitHub Actions repo secret), applies the
LocalStack-including overlay, waits for it to be ready, and reseeds its
secrets/IAM role via `infra/aws/seed-localstack.sh` — all before `api`'s
rollout, so it always boots reading `DATABASE_URL`/`EMAIL_HASH_SECRET`
from LocalStack rather than the plaintext k8s `Secret`.
**Why:** the user explicitly wants secrets/IAM actually exercised on
every local deploy, not proven-once-then-left-opt-in. D22 already
established the wiring works; leaving it opt-in meant it would only get
exercised on the rare occasion someone remembered to apply
`dev-localstack` by hand — closer to "built and forgotten" than
"actually used." Making it the default costs one extra ~15s round trip
per deploy (LocalStack readiness wait + reseed) for a local, free
cluster where that's a non-issue.
**Not a Phase 8 trigger:** this is still solo local dev against `kind`
— no real AWS account, no shared/staging environment, no real candidate
data. D20/D22's boundary is unchanged: LocalStack's free tier still
doesn't evaluate IAM policies for real and still doesn't emulate EKS.
**Ordering note:** the auth-token Secret must be provisioned *before*
the overlay creates the LocalStack Deployment — its `secretKeyRef` env
var doesn't hot-reload, so a Secret created after pod creation needs a
manual pod restart to take effect. CD provisions the Secret first for
exactly this reason (see `cd.yml`'s own step comment).
**Revisit when:** same as D22 — a real Phase 8b/8d trigger against a
real AWS account, at which point this same sequencing (provision
credentials → deploy → wait → seed/verify → roll out `api`) points at
real AWS Secrets Manager/IAM instead of LocalStack.

---

### D24 — Postgres consolidates to a single instance: kind's, not Docker Compose's

**Decision:** Native local `api` dev (`npm run start:dev`) and local
`npm run test:e2e` now point at kind's `postgres-0` StatefulSet (Phase 7
issue #27) via `kubectl -n interview-insights port-forward svc/postgres
5432:5432`, not `infra/docker-compose.yml`'s Postgres container. Local
e2e runs specifically target a second database on that same instance —
`interview_insights_test` — created once (`CREATE DATABASE
interview_insights_test;` against `postgres-0`) and kept schema-current
via `prisma migrate deploy`, invoked via a `DATABASE_URL` override rather
than a separate `.env` file:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/interview_insights_test?schema=public" npm run test:e2e
```

OpenSearch is explicitly **not** part of this change — `docker compose up
-d opensearch` still runs it, same as before; only Postgres consolidates.

**Why:** investigating a live-verification discrepancy (issue #125's
manual golden-path check) surfaced that this machine also runs Postgres.app
(a standalone macOS GUI Postgres, unrelated to this repo) bound to the same
`127.0.0.1:5432` that `infra/docker-compose.yml` publishes to — and macOS
silently routed connections to Postgres.app instead of the Compose
container. That meant "the Postgres `api` is talking to" was ambiguous
depending on what else happened to be running on the host, with no error
or warning either way. Rather than just fix the immediate collision, the
user chose to remove the ambiguity structurally: one Postgres, period —
kind's, since it's already the closest thing to a real deployment and
every other environment (CD, the golden-path verifications from Phases
7-13) already depends on it being correct.

A separate `interview_insights_test` database (not a separate server) on
that same instance matters because local e2e runs create real rows
(companies, candidates, ratings) — pointing them at the same database
used for manual dev/verification would litter it with disposable test
data, the identical class of problem that caused Phase 3 issue #3's
fraud-checks e2e flakiness (leftover rows in a persistent volume). Same
server, isolated database — satisfies "one Postgres" without polluting
real data.

**Not touched by this decision:** CI's `api` job already runs its own
fully ephemeral Postgres service container per workflow run
(`.github/workflows/ci.yml`), entirely unrelated to local dev or kind —
unaffected either way.

**No data migration needed:** everything previously in Postgres.app and
Compose's Postgres was disposable dev/test churn, not canonical data —
kind's `postgres-0` already has its own independent history from every
manual golden-path verification since Phase 7. Decommissioning the other
two loses nothing worth keeping.

**`infra/docker-compose.yml`'s `postgres` service is kept, deliberately
unused:** the user is deleting Postgres.app directly, but chose to leave
the Compose file's `postgres` service definition in place rather than
remove it — it now serves purely as a documented reference/alternative
local-dev path (e.g. for a future project cloning this repo's patterns,
or a quick non-`kind` sanity check), not something anyone should actually
point `api` at day to day. `kind` is the only Postgres genuinely in use
going forward; the Compose service stays present but inert.

**Revisit when:** if OpenSearch's identical split (Compose container vs.
kind's StatefulSet) ever causes the same kind of silent-wrong-target
confusion — deliberately out of scope for this decision, see the note
above.

---

### D25 — LocalStack self-reseeds via its own init-hook, not a PVC

**Decision:** `infra/k8s/base/localstack/init/seed.sh` is mounted into the
LocalStack container at `/etc/localstack/init/ready.d/` (LocalStack's own
[lifecycle-hooks](https://docs.localstack.cloud/user-guide/lifecycle-hooks/)
mechanism, via a `configMapGenerator`-produced ConfigMap in
`infra/k8s/base/localstack/kustomization.yaml`) so it runs automatically
every time LocalStack finishes starting — including after an *unplanned*
restart, not just a deliberate `kubectl apply`/CD run.

**Why:** discovered live, not hypothetically — while investigating D24's
Postgres confusion, `api` turned out to have been crash-looping for ~9
hours with the same `ResourceNotFoundException` issue #108 already fixed
once, but for a new reason: LocalStack's pod itself had restarted (exit
code 255, cause unrelated to this app) and, having no PVC by design
(issue #78 — "not a source of truth"), lost all its seeded Secrets
Manager/IAM state. Nothing noticed or re-seeded it, so `api` sat broken
until this investigation found it. The manual recovery
(`infra/aws/seed-localstack.sh` + `rollout restart deployment/api`) still
works and is documented in `wiki/deployment-guide.md` section 3 as a
fallback, but requires a human to notice first — this closes that gap
structurally instead.

**Not the same script as `infra/aws/seed-localstack.sh`:** that one runs
*outside* the container (CD, `bootstrap-kind.sh`, a human) and needs an
explicit `--endpoint-url`/region/fake credentials plus a human-facing
assumed-role verification step; the init-hook runs *inside* the
container, where the bundled `awslocal` wrapper needs none of that.
They're coupled by convention (same secret/role/policy names and
values), not by shared code — if one changes, update the other.

**Deliberately not a PVC:** persisting LocalStack's actual state would
also work, but would reverse issue #78's explicit "not a source of
truth" tradeoff for what both the CLAUDE.md and D20 already frame as a
free/local practice tool, not infrastructure worth hardening. Automating
the existing "reseed on start" behavior closes the real gap (nobody
noticing) without taking on that tradeoff.

**Gotcha hit building this:** `configMapGenerator`'s output doesn't
inherit a namespace the way resources with their own hardcoded
`metadata.namespace` do — the first apply attempt silently created the
ConfigMap in the `default` namespace instead of `interview-insights`,
which the Deployment's volume mount then failed to find
(`FailedMount: configmap ... not found`). Fixed by adding an explicit
`namespace: interview-insights` to
`infra/k8s/base/localstack/kustomization.yaml` (a no-op for
`08-localstack.yaml`'s own resources, which already hardcoded it).

**Verified live, adversarially:** deleted the running LocalStack pod
directly (not just re-running a script), confirmed the init-hook logged
`[init-hook] seeding Secrets Manager + IAM` / `[init-hook] done` on the
replacement pod's own startup, then rolled `api` out with *no* manual
seed step — it came up clean on the first try.

---

### D26 — OpenSearch consolidates to kind too; local e2e isolates via an index prefix

**Decision:** D24's "one server only" now covers OpenSearch as well:
native local `api` dev and local `npm run test:e2e` point at kind's
`opensearch` StatefulSet via `kubectl port-forward svc/opensearch
9200:9200`, and `infra/docker-compose.yml`'s `opensearch` service joins
its `postgres` service as inert, documented reference only. This
resolves D24's own "revisit when" clause, which had scoped OpenSearch
out at the time (user's call — "Postgres only for now").

**Why now:** the user spotted the split directly (two OpenSearch
containers visible in Docker — the Compose one, plus the in-cluster one
inside the `kind` node container) and asked to consolidate. It was also
already exhibiting the exact D24 failure mode: Docker publishes the
Compose OpenSearch on `0.0.0.0:9200` while `kubectl port-forward` binds
`127.0.0.1:9200`, and both can coexist — so with both running,
`localhost:9200` was ambiguous about which store it hit, silently.

**The isolation wrinkle Postgres didn't have:** Postgres gave local e2e
a free isolation boundary — a second database
(`interview_insights_test`) on the same server. OpenSearch has no
database concept; indices are the only namespace, and the index names
(`companies`/`reviews`) were hardcoded. Pointing e2e at kind's
OpenSearch unmodified would have written test companies straight into
the indices the deployed app's real search reads from. Fixed with a
minimal `OPENSEARCH_INDEX_PREFIX` env var
(`api/src/search/search-index-name.util.ts`, default empty — CI and
every deployed environment keep the bare names unchanged): local e2e
sets `e2etest-`, so test documents land in
`e2etest-companies`/`e2etest-reviews`. Those indices are disposable —
delete anytime with `curl -X DELETE http://localhost:9200/e2etest-*`.

**Verified:** full e2e suite (57 tests) against kind's OpenSearch +
kind's Postgres test database with the prefix set — the deployed app's
real `companies`/`reviews` doc counts were captured before and after
the run and were byte-identical (2/1 → 2/1), with all test churn
confirmed in `e2etest-*` (38/10 docs). CI unaffected (its own ephemeral
OpenSearch service container, empty prefix).

---

### D27 — Admin session CSRF stance, and a flag to remember for Phase 8

**Decision:** `admin_session`'s `SameSite=Lax` is treated as sufficient
CSRF protection for now — no separate CSRF token. Every modern browser
withholds a `SameSite=Lax` cookie from a cross-site `POST` (the classic
CSRF vector against `ModerationController`'s approve/reject/flag
routes), so a foreign page can't ride the admin's session to call those
endpoints. This is a considered, written-down acceptance, not an
oversight surfaced by omission.

**Why not a token too:** defense in depth is real, but a CSRF token
needs somewhere to live that a form can read it from — the standard
answer is a second, non-httpOnly cookie or a value baked into
server-rendered HTML, neither of which this app has today (the
moderation page is a client-rendered SPA route with no server-rendered
form). Building that scaffolding for a single-admin, `SameSite=Lax`-
already-covered surface is exactly the kind of ahead-of-need complexity
this project's own conventions warn against.

**Also flagged here so it isn't forgotten:** `COOKIE_SECURE` (added
alongside this decision, see the admin-auth bugfix PR) defaults to
`false` in every overlay today, matching the plain-HTTP reality of
local `kind`. The moment a real TLS-terminated environment exists —
Phase 8's eventual staging trigger — that overlay's `api-config`
ConfigMap needs `COOKIE_SECURE: "true"` explicitly; nothing enforces
this automatically, and forgetting it means the session cookie is sent
in the clear over a connection that has TLS available.

**Revisit when:** this surface stops being a single-admin,
same-origin-only, client-rendered SPA route — e.g. if a second admin,
a server-rendered form, or a non-cookie API client is ever added, the
CSRF answer above no longer holds and needs re-deriving, not assumed
to still apply.

---

### D28 — `kubectl apply` doesn't reliably prune keys removed from a Secret's `stringData`

**Found while rotating the admin credential (GitHub issue #192):**
`infra/k8s/base/05-api.yaml`'s `api-secrets` Secret had `ADMIN_USERNAME`/
`ADMIN_PASSWORD_HASH`/`ADMIN_JWT_SECRET` removed from its `stringData`
(moved to the new `admin-credentials` Secret and the `api-config`
ConfigMap). After `kubectl apply -k` ran via CD, the live Secret's
`.data` still had all three old keys, with their old dev-only values —
confirmed directly with `kubectl get secret api-secrets -o
jsonpath='{.data}'`, not assumed. The `kubectl.kubernetes.io/last-
applied-configuration` annotation was correctly updated to the new,
smaller `stringData`; the live `.data` just never caught up.

**Why:** a `Secret`'s `stringData` field is write-only — the API server
converts it into `.data` (base64) on write and never persists
`stringData` itself on the stored object. `kubectl apply`'s 3-way merge
diffs the previous `last-applied-configuration` against the new one to
compute which keys were removed, but the live object it compares
against has no `.stringData` to reconcile against (only `.data`) — so a
key removed from `stringData` doesn't reliably turn into a deletion of
the corresponding `.data` key. This is a known class of `kubectl
apply`/`stringData` interaction, not something specific to this repo's
manifests.

**Did this cause a real bug here?** No — `envFrom` merges multiple
sources additively, and duplicate keys resolve to whichever source is
listed last; `admin-credentials` is listed after `api-secrets` in
`05-api.yaml`'s Deployment, so the pod's actual env vars were already
correct (verified: `kubectl exec deploy/api -- printenv` showed the new
rotated values, and a live login test confirmed the old dev-only
password no longer authenticates while the new one does). The stale
keys were inert — but silently wrong data sitting in a Secret is still
worth not shipping, especially since a future reordering of `envFrom`
would have silently resurrected the old dev-only credential.

**Fix applied:** `kubectl patch secret api-secrets --type=json -p='[...
"op":"remove" ...]'` to explicitly strip the three stale keys from
`.data`. This was a one-time manual cleanup of the already-live
cluster, not a code change — `kubectl apply` going forward won't
recreate this specific problem since the keys are gone from every
future desired-state manifest too.

**Revisit when:** removing a key from any other Secret's `stringData`
in this repo — don't assume `kubectl apply` alone cleans it up; verify
with `kubectl get secret <name> -o jsonpath='{.data}'` after applying,
and patch it out explicitly (as above) if it's still there.

---

### D29 — Mailpit for local email delivery, not LocalStack SES

**Decision:** Phase 16's magic-link auth (GitHub issue #144) sends
email through Mailpit — a dedicated local SMTP catcher with a real web
UI and REST API — rather than LocalStack's SES emulation, despite
LocalStack already being the established local-practice pattern for
AWS-shaped services (D20/D23). Added as a core local dependency
(`infra/k8s/base/08-mailpit.yaml`, unconditional in `docker-compose.yml`)
the same way Postgres/OpenSearch already are — not gated behind the
`dev-localstack` overlay, since it has nothing to do with LocalStack or
secrets emulation.

**Why not LocalStack SES:** LocalStack SES emulation exists to validate
*real AWS SES integration code* ahead of a real AWS account (D20's
whole point — free, zero-real-account-risk practice for Phase 8b/8d).
Phase 16 has no near-term real-sending plan; it just needs a local mail
transport this project's own code can send through and inspect during
development and e2e tests. Mailpit is purpose-built for exactly that —
a real SMTP server plus a queryable REST API
(`GET /api/v1/search?query=to:...`) — with none of the AWS-shaped
scaffolding (IAM roles, `SES` service surface, real provider parity)
that would only matter if this project were actually about to send
through SES for real. Introducing that scaffolding now, for a feature
with no concrete AWS-SES plan, would be exactly the kind of ahead-of-
need complexity this project's conventions warn against.

**Verified, not assumed:** Mailpit's REST API shape (`GET
/api/v1/messages`, `GET /api/v1/search?query=`, `DELETE
/api/v1/messages`) was confirmed by running the real `axllent/mailpit`
image locally and sending a real test message through it — the
project's own docs site didn't have the exact endpoint/response shape
crawlable, so guessing was avoided in favor of hitting the real API
directly. Same reasoning for the k8s manifest's health probes:
Mailpit's docs don't document a dedicated health-check endpoint (no
`/readyz`/`/healthz`), so `infra/k8s/base/08-mailpit.yaml` uses a
`tcpSocket` probe on the web UI port instead of guessing an HTTP path
that might not exist.

**Revisit when:** a real Phase 8 trigger makes actual email delivery
(not just local dev/testing) a real requirement — that's the point at
which a real provider (SES or otherwise) gets wired in, informed by
whichever cloud (AWS vs OCI, D11's still-open question) is chosen then.

---

### D30 — Magic-link login supersedes D14's standalone verification flow; session logic shared, not duplicated, between admin and candidate auth

**Decision:** GitHub issue #145's candidate magic-link auth
(`api/src/candidate-auth/`) replaces the Phase 3 `candidate-verification/`
module entirely — `POST /candidates/:id/verification-token` and
`POST /candidates/verify` are removed, not just deprecated alongside the
new flow. The underlying `CandidateVerificationToken` table and its
generate/hash utilities are reused as-is (moved into `candidate-auth/`,
no migration needed) — only the module built on top of them changed.

**Why remove, not just add alongside:** D14 explicitly named the old
flow's security gap — "anyone who can call the API on a candidate's
behalf can verify them without proving email ownership," acceptable
only because no email was ever actually sent. Leaving the old endpoints
live after the new, actually-secure flow existed would mean that gap
still fully applies via the old route — building a secure front door
next to a door with no lock isn't a fix. Confirmed safe to remove by
checking `web/`'s own code first: no page ever called either old
endpoint (`docs/ARCHITECTURE.md`'s own "Known gaps" section said so —
that bullet is now removed too, the gap it named no longer exists).

**Session mechanism:** stateless signed JWT httpOnly cookie
(`candidate_session`), the same shape as Phase 18's `admin_session` —
decided during Phase 16's kickoff brainstorm, before any code was
written (see the issue #144/#145 bodies for the full reasoning: no
current requirement needs server-side revocation, so a DB-backed
sessions table would be complexity without a concrete need). A
**distinct** signing secret (`CANDIDATE_JWT_SECRET`, separate from
`ADMIN_JWT_SECRET`) — compromising one session type shouldn't let
anyone forge the other.

**Shared, not duplicated, this time:** two pieces of admin-auth's own
logic were extracted to `api/src/common/` so a second consumer
(candidate-auth) can't silently drift from a fix the first one already
needed:
- `session-cookie-options.util.ts` — the `COOKIE_SECURE`-driven cookie
  options object (the Secure-cookie-over-plain-HTTP bug fix). Both
  `admin-auth.controller.ts` and `candidate-auth.controller.ts` now call
  the same function instead of each hardcoding their own copy.
- `ip-throttle.ts` — the per-IP attempt-counting core
  `LoginThrottleService` already had. `admin-auth`'s and
  `candidate-auth`'s throttle services are now both thin wrappers over
  one shared `IpThrottle` class, each with their own instance/window
  (an IP throttled on admin login isn't also blocked from requesting a
  candidate magic link) — only the counting logic itself is shared.

**Verified:** the full request-link → email → extract token from
Mailpit's REST API → verify → session cookie loop, run against real
Postgres and a real Mailpit instance (not mocks) — reuse/unknown-token
rejection, first-login-only `verifiedAt`, and the request-link
throttle all covered by e2e tests using per-test-fresh app instances
(cumulative throttle state across tests sharing one instance tripped
the limit early in a first pass — same class of issue admin-auth's e2e
suite hit once already, fixed the same way).

**Also found and fixed while wiring this up:** Docker Compose's `full`
profile (`docker compose --profile full up`) never received
`ADMIN_USERNAME`/`ADMIN_PASSWORD_HASH`/`ADMIN_JWT_SECRET`/
`COOKIE_SECURE` when Phase 18 shipped — `AdminAuthModule` throws
synchronously at boot if any are unset, so that profile's `api`
container has been unable to start at all since. Fixed alongside adding
`CANDIDATE_JWT_SECRET` to the same block. Confirmed the bcrypt hash's
`$` characters survive Compose's own `$VAR`-style interpolation intact
(`docker compose run --rm --no-deps --entrypoint printenv api
ADMIN_PASSWORD_HASH` against a real container) rather than assumed —
Compose's variable-name pattern doesn't match `$2b`/`$10`-shaped
sequences, so they pass through as literal text.

**Revisit when:** a second admin (Phase 18's own scope note) or a
requirement for server-side session revocation ever arrives — either
would reopen the "stateless JWT is enough" call this D30 and Phase
18's D-something both made independently, for the same reasons.

---

## Still open (revisit when you have more information)

- Exact `k` value for shrinkage scoring — needs real review volume to tune.
- Whether `company_overall_aggregates` should be sliced by role/level from
  the start or added later.
- Retention/deletion policy for moderation queue + rejected content (GDPR
  erasure path).
