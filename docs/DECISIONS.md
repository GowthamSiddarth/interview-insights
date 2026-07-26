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
would reopen the "stateless JWT is enough" call this D30 makes, the
same choice Phase 18's admin-auth session design made independently
(without its own dedicated D-entry) for the same reasons.

---

### D31 — Every candidateId-bearing write requires a session; unauthenticated gets a plain 401, no fallback

**Decision:** GitHub issue #146 made `candidateId` come exclusively from
the authenticated session (`CurrentCandidateId`, backed by
`CandidateJwtAuthGuard`) on every write path that has a `candidateId`
column — which turned out to be **four**, not the three named in the
issue's own prose ("round rating, recruiter interaction+rating, overall
review"): `InterviewProcess` creation
(`POST /companies/:companyId/processes`) also has one and was easy to
miss on a first read of the issue text alone. Confirmed by grepping the
Prisma schema directly for every `candidateId` field rather than
trusting the issue's wording — `RecruiterInteraction` itself has no
`candidateId` (only `RecruiterRating`, its child, does), so "recruiter
interaction+rating" in the issue was really naming one write path, not
two, and the schema search is what surfaced the real fourth one.

An unauthenticated request to any of the four gets a plain 401 — no
anonymous-submission fallback, no grace period. This is the explicit
answer to the issue's own "decide (and document) what happens to
unauthenticated submission" bullet. The practical consequence: `web`'s
wizard, which starts with a "candidate email" step calling the now-
removed `POST /candidates`, is broken from this commit forward — not a
regression, the same deliberate "the frontend catches up in the next
issue" sequencing Phase 18 used (issue #159 broke the moderation UI on
purpose; issue #160 fixed it). Issue #147 (login/logout UI + wizard
integration) is that catch-up here.

**`POST /candidates` removed entirely, not just gated:** candidate
creation is upsert-by-email logic (`CandidatesService.create()`) that
now only runs *inside* `POST /auth/request-link` — there is no public
route left that calls it directly. Keeping a standalone
`POST /candidates` around (even gated behind nothing, as before) would
have been a second, parallel way to mint a candidate identity without
ever proving email ownership — undermining the entire point of this
issue for that one endpoint. `GET /candidates/:id` stays public and
unchanged — it's a read, not a write, and out of this issue's scope.

**e2e pattern established here, worth reusing:** `api/test/support/
candidate-session.ts`'s `loginAsCandidate()` drives the real
request-link → Mailpit → verify → cookie loop for any test that needs
an authenticated candidate — the same shape as `admin-session.ts`'s
`loginAsAdmin()`. Every affected e2e spec was also converted from a
shared `beforeAll` app to a fresh app per test (`beforeEach`/`afterEach`)
— a shared instance's cumulative `/auth/request-link` calls across a
whole file's tests routinely exceeded `MagicLinkThrottleService`'s
5-per-window limit once several tests each needed their own candidate
login (`overall-reviews.e2e-spec.ts` hit this directly; several others
were sitting exactly at the boundary, one added test away from the same
failure). This is now the default pattern for any e2e spec that logs in
more than once or twice per file.

**Revisit when:** issue #147 rebuilds the wizard against session-based
auth — at that point `web/src/lib/api.ts`'s `createCandidate()` client
method (calling the now-nonexistent route) needs removing too, and the
wizard's flow needs restructuring around "log in first," not "enter an
email inline."

---

### D32 — Candidate session state in `web`: a non-httpOnly hint cookie, not a `GET /auth/me` poll; a hard navigation after magic-link verify

**Context:** issue #147 added `GET /auth/me` (mirroring admin's
`GET /auth/admin/me`, #160) and had `NavBar` — rendered on every route,
for every anonymous visitor too, unlike the moderation page's own
session-check gate which only ever runs for someone already trying to
moderate — call it on mount to decide "Log in" vs. "Log out". Live
Playwright verification caught two real problems this surfaced, neither
visible from unit/component tests alone:

1. **A `GET /auth/me` call from every anonymous page view produces a
   401, and Chromium logs every non-2xx fetch response to the console
   as "Failed to load resource" — regardless of whether the app's own
   `.catch()` handles it.** That's a real console error on the
   platform's single most common page view (an anonymous candidate
   browsing before ever logging in), not a false positive: it fails
   this project's own "zero console errors" verification bar the
   moment more than one page is visited anonymously in a row.
2. **After a successful `/auth/verify`, using `router.push('/')`
   (client-side navigation) left `NavBar` stuck showing "Log in" even
   though the session cookie was just set** — `NavBar` is mounted once
   in the root layout and persists across client-side route changes
   inside the same session, so its own `useEffect([])` session check
   never re-runs just because the URL changed underneath it.

**Decision:**
- `candidate-auth.controller.ts`'s `verify()` now sets a second cookie,
  `candidate_logged_in=1` — a plain, non-httpOnly companion to the real
  `candidate_session` JWT cookie, carrying no secret, set/cleared in
  lockstep with it (same `verify()`/`logout()` calls, same `maxAge`).
  `web`'s `NavBar` and the wizard's step-2 gate read this via
  `document.cookie` (`api.hasCandidateSessionHint()`) synchronously, no
  network call, to decide "show Log in" vs. "show the logged-in state" —
  eliminating the doomed-to-401 request entirely for the common case.
  `GET /auth/me` itself is unchanged (still 401s on a missing/invalid
  session, same as admin's) and stays the real source of truth for
  anything that needs the actual `candidateId` — nothing in `web` does
  yet, so it's currently only exercised by its own e2e test, kept for
  parity with the admin pattern and for whatever needs it next.
- `web/src/app/auth/verify/page.tsx` uses `window.location.href = '/'`
  after a successful verify, not `router.push`. A hard reload remounts
  `NavBar` (and every other client component on the page) fresh, so it
  picks up the just-set cookies honestly instead of showing stale state
  until the next full navigation.

**Why not fix this by making `GET /auth/me` return 200 with a null body
instead of 401 on a missing session?** That would special-case
candidate's endpoint away from the mirrored admin pattern
(`GET /auth/admin/me` intentionally 401s — `admin-auth.e2e-spec.ts`
asserts it) for a problem that isn't really about the endpoint's
contract — it's about *how often* something calls it. The hint-cookie
fix addresses the actual cause (a passive, page-view-scoped check has
no business making a network call at all) without changing an endpoint
whose contract other tests already depend on.

**Revisit when:** anything in `web` actually needs the real
`candidateId` value (not just a yes/no) — at that point call
`GET /auth/me` once, on demand, at the point of need, rather than
reintroducing a passive poll.

---

### D33 — Update/Delete (GitHub issue #150): shared per-candidate edit throttle, and how a re-enqueue avoids two live moderation entries for one entity

**Decision:** GitHub issue #150 closes Phase 2's original Update/Delete
deferral, scoped (per the Phase 17 kickoff brainstorm) to exactly the
three moderated content types — `RoundRating`, `RecruiterRating`,
`OverallReview` — never the structural entities (`Company`/
`InterviewProcess`/`Round`/`RecruiterInteraction`), which stay
create+read-only permanently.

**Edit throttle is one shared instance across all three entity types,
not three independent counters.** `EditThrottleService`/
`EditThrottleGuard` live in a new `api/src/common/edit-throttle.module.ts`
(same per-key in-memory shape as `IpThrottle`, but keyed by candidateId
instead of IP), imported by `RoundRatingsModule`/`RecruiterRatingsModule`/
`OverallReviewsModule` alike — Nest dedupes a shared static module across
an import tree, so all three controllers' `PATCH` routes drive the same
counter per candidate (5 edits/hour, a placeholder like every other
threshold in this codebase — D13's `k`-style "tune later" caveat
applies here too). A single shared budget, not per-type ones, because
the abuse this guards against — repeatedly editing to churn the
moderation queue with fresh entries — doesn't care which entity type the
churn comes from.

**Found the hard way: a guard referenced by class in `@UseGuards()` needs
its own dependencies exported from the shared module too, not just the
guard itself.** `EditThrottleModule` originally only exported
`EditThrottleGuard`; every e2e test failed at app-bootstrap with "Nest
can't resolve dependencies of the EditThrottleGuard... make sure
EditThrottleService is available in the RoundRatingsModule module" —
because `@UseGuards(EditThrottleGuard)` resolves the guard (and,
transitively, whatever it needs) from the *consuming* controller's own
module context, not silently from wherever the guard happens to be
defined. Fixed by exporting `EditThrottleService` alongside the guard.
Worth remembering for any future shared guard extracted the same way —
`LoginThrottleGuard`/`MagicLinkThrottleGuard` never hit this because
their throttle service is declared directly in the same module as the
guard's own usage, not imported from elsewhere.

**An edit never modifies public content in place** — it resets `status`
to `pending` and gets a fresh `moderation_queue` entry, going back
through the full moderation gate exactly like a new submission (hard
constraint #2 stays intact). The one real wrinkle: if the previous
submission is still unreviewed at edit time, naively creating a second
entry would leave two live queue entries pointing at the same entity —
a moderator could review the same entity twice, the second decision
silently overwriting the first. `ModerationService.reenqueue()` deletes
any still-unreviewed entry for that entity before creating the new one,
so exactly one live entry ever exists per entity. `removeQueueEntries()`
handles the mirror case on delete — every entry for a deleted entity is
removed (reviewed or not), since `moderation_queue`'s reference is
polymorphic, not an FK, and nothing else would ever clean it up.

**Delete cascades to the search index too, but only for `round_rating`**
— the only entity type `ReviewSearchService` ever indexes (D17's scope
note). `ReviewSearchService.removeReview()` is best-effort, same
D16/D17 pattern as indexing an approval: runs after the DB delete has
already committed, silently accepts a 404 (never indexed — the rating
was still pending/rejected/flagged at delete time), and only logs (never
throws) on anything else.

**Revisit when:** issue #150's placeholder throttle numbers need real
tuning against actual edit-abuse volume, same caveat as every other
threshold introduced this way in this codebase.

---

### D34 — GDPR erasure (`DELETE /me`, GitHub issue #151): delete, not anonymize; structural entities are in scope here even though #150's edits/deletes never touch them; a DB existence check on every candidate-session request

**Decision:** Closes the retention/deletion open decision that had sat in
`docs/DECISIONS.md`/CLAUDE.md's "Open decisions" since Phase 1.

**Delete every row, don't anonymize anything.** No raw candidate identity
is stored anywhere to begin with (`Candidate.emailHash` is an HMAC, never
the raw email — docs/DATA_MODEL.md design principle 1), and the public
aggregates this candidate's approved content fed into
(`company_round_type_aggregates` etc.) are already de-identified
statistics — out of GDPR scope once computed, and they simply recompute
correctly on their next refresh once the underlying rows are gone. There
was nothing here that needed a tombstone row to stay consistent, unlike
some erasure designs that anonymize-in-place to preserve foreign-key
shape; a hard delete is simpler and was the right call.

**Structural entities (`InterviewProcess`/`Round`/`RecruiterInteraction`)
are in scope for this erasure, even though issue #150's Update/Delete
explicitly excluded them.** The two issues are answering different
questions: #150 was about whether editing/deleting *content* (an opinion,
a rating) should be allowed post-submission without undermining
moderation — structural facts ("there was a round called X") aren't
opinions, so they stayed permanent. GDPR erasure is about whether a
person's data can persist after they ask for it to be gone — and
`InterviewProcess.candidateId` is a required, non-nullable FK (no
`onDelete: Cascade` in `schema.prisma`), so a process literally cannot
exist without a candidate owning it. Deleting the account without also
deleting its processes/rounds/interactions isn't an option Prisma's
schema even permits (it would 23503 on the `Candidate` delete) — so
`MeService.eraseMe()` deletes, in FK-safe order: `RoundRating`/
`RecruiterRating`/`OverallReview` (+ their `moderation_queue` entries,
gathered by id list up front — same idea as #150's
`removeQueueEntries()`, batched here instead of one entity at a time) →
`Round`/`RecruiterInteraction` → `InterviewProcess` →
`CandidateVerificationToken` → `Candidate` last. An approved round
rating's OpenSearch document is best-effort removed after the
transaction commits, same D16/D17 pattern as every other search-index
mutation.

**The shared `Recruiter` row is never touched.** Only the candidate's own
`RecruiterInteraction` rows are deleted — `Recruiter` is per-company
internal identity (CLAUDE.md hard constraint #1), and another candidate's
`RecruiterInteraction`/`RecruiterRating` referencing that same row (same
company, same recruiter identifier — a real, not hypothetical, case) must
survive completely unaffected. Proven directly in
`gdpr-erasure.e2e-spec.ts`, not just asserted.

**Stale-session handling (decided during the Phase 17 kickoff
brainstorm, implemented here): `CandidateJwtStrategy.validate()` now
queries `candidate.findUnique()` and throws `UnauthorizedException` if
the candidateId no longer exists.** Candidate sessions are stateless
JWTs with no server-side revocation list (Phase 16's own brainstorm
decision) — without this check, a token issued before erasure (copied
elsewhere, or a second device that never called `DELETE /me`) would
still pass JWT signature/expiry verification and reach a route handler,
which would then fail downstream with an FK or not-found error instead
of a clean 401. The trade-off is one extra DB round trip on *every*
authenticated candidate request, not just erasure-adjacent ones — an
explicit, accepted cost for correctness over the stateless design's
usual "no DB hit needed" appeal. `DELETE /me` itself also clears both
session cookies (`candidate_session`/`candidate_logged_in`) the same way
`POST /auth/logout` does, even though the strategy check alone would
already 401 their next use.

**Revisit when:** if candidate session volume ever makes the
per-request `candidate.findUnique()` a real bottleneck — a short-TTL
in-memory negative cache (only caching "this ID was erased," never
caching a positive existence result past the JWT's own expiry) would be
the natural next step, not reverting the check.

---

### D35 — CD prunes stale Docker artifacts after every deploy (real incident, 2026-07-24)

**Context:** the PR #208 merge (GDPR erasure, unrelated to this incident
itself) triggered CD as usual, and `cd.yml`'s "Roll out api" step timed
out — the new pod crash-looped instead of becoming ready. The crash was
OpenSearch refusing index operations: first `index_create_block_exception`
(a cluster-wide block), then, after that was cleared, `cluster_block_exception`
with `disk usage exceeded flood-stage watermark`. Direct investigation
found the actual cause several layers removed from the app: the shared
Docker Desktop disk `kind`'s node draws from was at 96% (only 2.6GB
free of 59GB), almost entirely from build cache (24.6GB) and dangling,
untagged images accumulated over roughly five days of CD runs. Every
run's "Build api/web image" step produces a new image under the same
`interview-insights-{api,web}:k8s` tag, leaving the *previous* run's
now-untagged layers as dangling images — `kind load docker-image`
retags forward, it never removes what it's replacing. On a persistent
self-hosted runner (issue #88 — this is a standing local machine, not a
fresh disk per run the way a GitHub-hosted runner would be), that's
pure cumulative growth with nothing to bound it. `api`/`web` themselves
were never actually down during this — the old pod kept serving the
whole time the new one crash-looped — but the deploy was stuck and a
few more days at this rate would have made the node unusable.

**A costly near-miss while diagnosing this manually, worth recording so
it isn't repeated:** the first cleanup attempt ran `crictl rmi --prune`
*inside* the kind node's containerd directly. That briefly deleted the
image backing the then-currently-running `web` Deployment
(`interview-insights-web:k8s`) and the live `ingress-nginx-controller`
pod's image, neither one caught by `--prune`'s "unreferenced" logic
because Kubernetes tracks a running container by digest, not by the
tag `crictl` was pruning. Neither caused an actual outage (an
already-running container keeps running once started, regardless of
whether its image is still tagged) — but either would have failed to
restart from that point on. Both were restored immediately (rebuild +
`kind load` for the app image; `crictl pull` from `registry.k8s.io` for
the addon image) before any pod actually needed to restart. The lesson
kept here deliberately: node-internal image surgery (`crictl`/`ctr`) is
riskier than it looks, because it can't see "is this the image a live
Deployment/Pod spec currently points at" — a plain host-level `docker
image prune`/`docker builder prune` turned out to be both sufficient
(96% → 49% disk) and safe, since Docker Desktop's build cache and
genuinely-dangling images were the real source of the growth, not
anything the kind node's own containerd store needed to keep.

**Decision:** `cd.yml` gained a `Prune stale Docker artifacts` step
(`docker image prune -f` + `docker builder prune -f --filter
until=48h`) after the two rollout steps, with `if: always()` so a
*failed* deploy still gets cleaned up — that's exactly the run most
likely to leave extra dangling layers behind (a half-finished build, an
image tagged but never successfully rolled out). Deliberately scoped to
host-level Docker cleanup only, never `crictl`/`ctr` inside the kind
node — see the near-miss above. The `until=48h` filter on build-cache
pruning keeps roughly the last day or two of layers for build-speed
reuse rather than forcing every run back to a fully cold build, while
still bounding growth to a couple of days' worth instead of five.

**Revisit when:** if disk pressure recurs even with this step in place
(e.g. if the 48h cache window still isn't tight enough, or if Postgres/
OpenSearch's own data volumes grow enough to matter) — at that point
consider a stricter cache TTL or moving stateful data off the shared
disk entirely, not just tightening the prune step further.

---

### D36 — Full golden-path smoke test: opt-in script, not CI; a runtime guard against the exact class of incident D35 just cleaned up

**Context:** the cleanup that produced D35 also surfaced a second,
distinct problem — the dev Postgres/OpenSearch had accumulated real
rows (`Verify150 Corp`, `Verify151 Corp`, etc.) from every ad-hoc
Playwright verification script written per issue across this project's
history. Each one was a throwaway, never checked in, and pointed at the
persistent dev cluster because that's what "verify it live" has always
meant here. There was no repeatable, safe way to exercise the whole
feature set in one pass without either writing a new throwaway script
each time or leaving residue in a database nothing ever cleans.

**Decision:** `api/test/golden-path.smoke-spec.ts` — one continuous
narrative test walking company creation, candidate magic-link auth, all
three moderated content types, moderation approve/reject, search,
analytics (three approved round ratings, deliberately clearing the
`n < 3 → null` shrinkage floor so the assertion proves a real score, not
just the already-well-covered null case), my-reviews, update/delete
(issue #150), and GDPR erasure (issue #151) — reusing every existing
e2e helper (`loginAsCandidate`/`loginAsAdmin`/Mailpit) and the
`rawPrisma` direct-Postgres-assertion pattern `gdpr-erasure.e2e-spec.ts`
already established, rather than inventing new ones.

**A new `assertUsingTestDatabase()` helper (`api/test/support/
assert-test-database.ts`) throws immediately, before any Prisma/app
instance exists, if `DATABASE_URL` doesn't contain the literal
`interview_insights_test` (D24's fixed database name).** This is the
concrete guardrail against a repeat of the incident D35 documents:
this specific test creates, moderates, and erases real data end to
end, and is the one most likely to get run ad hoc, outside the routine
`npm run test:e2e` flow — exactly the same circumstance that let dev-DB
pollution accumulate unnoticed for so long. Deliberately scoped to just
this one spec, not retrofitted onto the other 20+ existing e2e files:
those already follow the manual-`DATABASE_URL`-override convention
without incident, and adding a second layer of runtime checking
everywhere would be defending against a problem that hasn't actually
occurred there.

**A new `npm run smoke:e2e` script, deliberately not part of
`npm run test:e2e` or `ci.yml`.** The 105+ per-feature e2e specs already
own PR-time regression coverage; wiring in a large, deliberately
redundant end-to-end narrative would slow down every CI run for a test
whose actual job is on-demand full-system sanity checking, not
per-commit gating. Documented as its own subsection in
`wiki/deployment-guide.md` (6.1), alongside the pre-existing manual
curl-based golden-path walkthrough (section 6) it complements rather
than replaces.

**A real-browser (Playwright) companion is explicitly out of scope
here**, decided the same way as the rest of this entry — this pass is
API/data-flow only (supertest, no browser), which catches everything
except actual frontend rendering/console-error regressions. Adding a
real browser driver is a larger, separate addition (a new dependency,
a new config, a new class of flakiness to manage) that wasn't worth
bundling into solving today's specific problem.

**Revisit when:** UI-level regressions (not just data-flow ones) become
a recurring pain point worth a checked-in Playwright script — at that
point, treat it as the deferred follow-up this entry already names, not
a retrofit onto this test.

---

### D37 — `GET /moderation/queue` isolates each entity type's enrichment (`Promise.allSettled`, not `Promise.all`); a transient Prisma required-relation race, not a data-integrity bug (GitHub issue #212)

**Context:** running the golden-path smoke test's own verification (stress-
testing the full e2e suite repeatedly) surfaced an intermittent 500 on
`GET /moderation/queue`, hitting a different, unrelated test file each
time. The server log showed
`PrismaClientUnknownRequestError: ... Field process is required to
return data, got \`null\` instead` from `recruiterRating.findMany()`'s
nested `include` (`recruiterInteraction -> process -> company`).

**Ruled out concurrency and data volume as the cause before looking
deeper — both are the obvious first guesses, and both were wrong.**
Reproduced identically under `--runInBand` (fully serial, zero
parallelism) and against a freshly truncated test database (actually
*more* often than against an aged one). Also confirmed it wasn't the
golden-path smoke test itself — reproduces with that file excluded.

**Confirmed directly against the live schema that a durable orphaned
row is impossible here**: `recruiter_interactions_process_id_fkey` is a
real, Postgres-enforced `FOREIGN KEY ... ON DELETE RESTRICT`. Postgres
would reject any delete that left a `RecruiterInteraction` pointing at
a gone `InterviewProcess`. So the null Prisma sees isn't a bad row at
rest — it's a **query-time race**: Prisma splits a nested `include`
this deep (three levels) into multiple separate round trips rather
than one atomic snapshot, and if a concurrent transaction — a GDPR
erasure (issue #151) or an Update/Delete (issue #150) delete, both of
which legitimately delete these rows — commits *between*
`listPending()`'s own round trips, the second round trip can find
nothing for a `processId` the first round trip already captured a
reference to. A required relation can't return null gracefully, so
Prisma throws.

**The real bug worth fixing wasn't the race itself — it was the blast
radius.** `listPending()` awaited all three entity types'
enrichment queries via `Promise.all`. One entity type's transient
failure rejected the *whole* `Promise.all`, crashing `GET
/moderation/queue` for every caller, regardless of what they actually
needed from it. That's why the failure kept jumping to unrelated test
files — it's a shared, global endpoint, and any concurrently-running
erasure/delete anywhere could poison it for everyone at that instant.

**Decision:** switched to `Promise.allSettled`, isolating each entity
type. A failed batch is logged (`this.logger.error`, a new
`settledOrEmpty()` helper) and degrades to an empty result — its
entries just get `entity: null`, the same graceful fallback already
used for a genuinely missing underlying row. One entity type failing
no longer affects the other two, and never crashes the endpoint
outright. This does **not** eliminate the underlying transient race —
a deeper fix would mean making the multi-query read fully
snapshot-consistent (e.g. a serializable transaction) — but making an
admin-facing read path resilient to an unrelated concurrent write
elsewhere in the system is the right scope here, not chasing full
isolation for a read that's inherently a point-in-time snapshot anyway.

**Verified concretely, not just assumed**: stress-tested the full e2e
suite (8+ consecutive runs) against a freshly truncated test database,
both before and after. Before: intermittent failures matching this
exact signature. After: the underlying transient Prisma error still
fires and logs (caught directly in server output across two separate
runs) but zero test failures resulted from it in any run.

**A separate, unrelated intermittent failure** (`Parse Error: Expected
HTTP/`, seen in `fraud-checks`/`recruiter-ratings`) was also observed
during this investigation — explicitly out of scope for this entry,
not chased further here.

**Revisit when:** if the underlying race itself ever needs eliminating
(not just contained) — e.g. if the moderation UI needs a stronger
consistency guarantee than "graceful degradation to null" — a
serializable transaction around `listPending()`'s reads would be the
next step, not a further patch on `Promise.allSettled`.

---

### D38 — `POST /companies` requires a candidate session + per-IP throttle; login-page copy no longer implies login-only

**Context:** a product review surfaced two real gaps, neither tied to a
specific phase issue: (1) the login page's copy ("If an account exists
for X, a login link is on its way") read as login-only, even though
`CandidateAuthService.requestLink()` always upserts the candidate —
there's no separate registration flow, the login form *is* the
registration flow, and the copy didn't say so; (2) `POST /companies`
had neither a session requirement nor any rate limiting, an open
anonymous-write gap that predated Phase 16's "sessions on the write
path" pass entirely — `Company` was never on that pass's list because
it has no `candidateId` column to protect, but that's an argument for
*why* it wasn't swept up automatically, not that it should stay open.

**Decision:**
- Login page copy rewritten to say plainly that the same link creates
  an account for a new email, removing the "if an account exists"
  hedge — that hedge was copied from an anti-enumeration pattern this
  system doesn't need (the endpoint already always returns the same
  `{ status: 'ok' }` shape and always upserts, so there's nothing left
  to enumerate).
- `POST /companies` gated with `CandidateJwtAuthGuard` *and* a new
  per-IP `CompanyCreationThrottleGuard`/`CompanyCreationThrottleService`
  (same `IpThrottle` shape as `MagicLinkThrottleService`/
  `LoginThrottleService`, its own separate counter). Both together,
  not one or the other — the session requirement means an abuser needs
  a real, working magic-link login first (itself throttled), and the
  IP throttle is defense in depth on top of that, same reasoning
  `EditThrottleGuard` (D33) already established for a different write
  path. Unlike every other session-gated write, this isn't about
  attributing the write to a candidate (`Company` still has no
  `candidateId`) — it's purely an access-control + abuse-prevention
  gate.
- `web`'s wizard: selecting an *existing* company (a read) stays
  ungated; only the create-a-new-company form is gated on
  `candidateSession`, mirroring exactly how the backend only gates the
  `POST`, not `GET /companies`.
- Every e2e spec that calls `POST /companies` (13 files, 20 call
  sites) updated to attach a candidate cookie — in the large majority
  of cases this was a one-line addition, since the test already logged
  in a candidate moments before for an unrelated reason; a handful
  needed either a new throwaway login added purely for the company-
  creation step, or (in two "unauthenticated request" tests) the
  existing login reordered to happen *before* company creation instead
  of after, since company creation itself is no longer the
  unauthenticated case those tests are actually about.

**Revisit when:** if `CompanyCreationThrottleService`'s placeholder
threshold (5/15min, same as its siblings) ever needs real tuning
against actual abuse volume — same "tune later" caveat as every other
threshold introduced this way in this codebase.

---

### D39 — Session cookies need an explicit shared `Domain`, or `web`'s JS can't see them on any deployed environment (GitHub issue #222)

**Context:** a user report — "nav bar shows log in even after login" —
traced back to `getSessionCookieOptions()` never setting a `Domain`
attribute on any session cookie. Without one, a cookie is host-only:
visible solely to the exact hostname whose response set it. Every
deployed environment serves `web` and `api` from genuinely different
hostnames (`app.interview-insights.local` vs
`api.interview-insights.local` in dev, matching `.staging.*`/`.prod.*`
patterns in the other overlays) — `POST /auth/verify`'s response comes
from `api`'s origin, so both `candidate_session` and D32's
`candidate_logged_in` hint cookie were scoped to `api`'s hostname only,
invisible to `document.cookie` reads from JS running on `web`'s
hostname. This was never caught by any prior "verified live in a real
browser" pass because nearly all of them ran against local `npm run
dev` servers on `localhost:3000`/`3001` — same hostname, different
port, and browsers scope cookies by host, not port. It only reproduces
against the real Ingress-fronted app.

The blast radius was larger than a cosmetic NavBar glitch: the
wizard's `candidateSession &&` gates (issue #217's create-company form,
the process-creation step) read the same hint cookie, so a genuinely
logged-in candidate on any deployed environment saw "Log in to submit"
prompts throughout the app — even though authenticated API calls
themselves worked fine (the browser attaches `candidate_session`
correctly on same-origin requests to `api` regardless of which host
the calling JS runs on; only the client-side JS *read* of the cookie
was broken).

**Decision:**
- `SessionCookieOptions` (`api/src/common/session-cookie-options.util.ts`)
  gained an optional `domain` field, sourced from a new `COOKIE_DOMAIN`
  env var. Default unset → today's host-only behavior, correct for
  local dev where `web`/`api` share the `localhost` hostname.
- `infra/k8s/base/05-api.yaml`'s `api-config` ConfigMap sets
  `COOKIE_DOMAIN: .interview-insights.local` (the shared parent of
  `app.*`/`api.*`), inherited by `dev`/`dev-localstack`; `staging`/`prod`
  overlays patch it to their own per-environment parent domain, mirroring
  the existing `CORS_ORIGIN` patch pattern exactly.
- Applies to every session cookie sharing this util — `admin_session`,
  `candidate_session`, and `candidate_logged_in` — not a candidate-auth-
  specific fix, since all three had the identical host-only gap.

**Verification:** 3 new unit tests for the domain behavior (unset,
empty string, explicit value); full 260-test unit suite, 105-test e2e
suite, and the golden-path smoke test all re-run clean; rebuilt and
rolled out the real `api` image against the live `kind` cluster and
confirmed via `curl` through the actual Ingress that `Set-Cookie` now
carries `Domain=.interview-insights.local`; a live headless-browser
(Playwright) run through `app.interview-insights.local` — real
magic-link request, fetched via Mailpit's REST API, verified — confirms
NavBar shows "Log out" both immediately after login and after a hard
reload, zero console errors.

**Revisit when:** never, structurally — this is a correctness fix, not
a placeholder pending tuning.

---

### D40 — Soft-gate company profile & analytics pages for anonymous visitors (GitHub issue #226, Phase 21)

**Context:** a UI/UX brainstorm surfaced a request to gate company
profile pages, the analytics dashboard, and "change company" behind
login. Taken at face value this contradicts Phase 15's explicit design
intent ("Public Company Profile Pages" — public discoverability is the
whole "Glassdoor for interview loops" premise), so it was raised
directly rather than silently implemented. Asked why: the motivation is
a deliberate pivot toward candidate signup pressure, not a scraping/
abuse concern or a misunderstanding of the existing design. Asked how
hard the gate should be: a soft gate — teaser content plus a CTA — not
a hard redirect-to-login wall, so an anonymous visitor still sees enough
to decide it's worth logging in (the same pattern Glassdoor itself
uses for its own deeper content).

**Decision:**
- **Company profile page** (`/companies/[slug]`) stays a light touch —
  the "hook": header (name, industry, size) and the "Overall experience"
  section remain visible to everyone. The "By round type" breakdown and
  reviews beyond the first are gated. The reviews section always shows
  the real total count and the first review in full, regardless of
  login state.
- **Analytics page** (`/companies/[slug]/analytics`) gets the
  aggressive gate — its own copy already frames it as "the full
  analytics breakdown," the deep-dive upsell from the profile page's
  link, so all three data sections (overall, round-type, recruiter)
  sit behind one combined prompt for anonymous visitors.
- **Scope call, made explicitly rather than assumed**: the homepage
  wizard's company picker and "Change company" button stay ungated.
  Both are pure navigation/state-reset actions — they display no
  company data themselves, they just point at (or reset) which
  company's profile/analytics a visitor will look at next. There's
  nothing in either action to tease; the actual gate belongs on the
  destination pages' content. Same reasoning extends to the `/search`
  page's "View profile" links — they just point at the now-gated
  destination, nothing to change there.
- New reusable `GatedSection` component
  (`web/src/components/GatedSection.tsx`), mirroring `EmptyState.tsx`'s
  minimal one-prop-object style: renders children when logged in, a
  placeholder card (dashed border, muted background, "Log in to
  unlock" link) when logged out, nothing while the session-hint check
  is still pending. Driven by the existing `hasCandidateSessionHint()`
  cookie-hint idiom already established in `NavBar.tsx`/the wizard
  (D32) — no network call, no new backend endpoint; both pages were
  already public `GET`s.
- **Not a violation of hard constraint #3** (shrinkage floor, never
  show null as zero): that constraint governs a score's *reliability*
  once shown (n<3 → null), not who's allowed to see it at all. Limiting
  *visibility* to logged-in users is a separate, new access layer
  layered on top, not a change to the scoring/display logic itself.
- No CSS blur effects — a placeholder card replacing the gated subtree
  entirely is simpler to implement, test, and reason about, and matches
  this codebase's existing minimalist component style. No SEO
  trade-off either: both pages are `'use client'`, fully client-rendered
  after mount with no SSR, so a crawler sees no real content either way
  regardless of gating.

**Revisit when:** if real signup-conversion data suggests the gate is
too aggressive (or not aggressive enough) on either page — this is a
first cut, not a tuned threshold.

---

### D41 — Visual design refresh: typography, depth/surface, and layout width (GitHub issue #231, Phase 22)

**Context:** a UI/UX brainstorm characterized the app as "looks simple
but not cool." An inventory of the actual styles confirmed it: default
Tailwind config (no custom font, no extended color palette, no
shadows), a single indigo accent used sparingly, flat `border-gray-200`
boxes for every section, and — a real gap, not just a stylistic
choice — no explicit page background at all, light or dark. Scoped to
three mechanical, low-risk directions (typography, depth/surface,
layout width); color-palette expansion and a real brand mark were
explicitly raised as a second-pass option, not attempted here, since
both are more subjective design-taste calls than the other three.

**Decision:**
- **Typography**: `Inter` via `next/font/google`, self-hosted at build
  time (fetched once during `next build`, served from the app's own
  origin — no runtime request to Google's CDN). Wired into Tailwind's
  `fontFamily.sans` via a `--font-sans` CSS variable set on `<html>`,
  with a system-font fallback chain for any context outside the root
  layout (e.g. a bare component test).
- **Depth & surface**: added an explicit page background
  (`bg-gray-50`/`dark:bg-gray-950` on `<body>`) — without one, a card's
  shadow has nothing to visually contrast against, so this was a
  prerequisite for the rest of this decision, not a separate item.
  Extracted a new `Card` component (`web/src/components/Card.tsx`,
  `rounded-xl border bg-white p-4 shadow-sm dark:bg-gray-900`) — 11 call
  sites across the app duplicated the identical flat-border string
  independently before this. `Card` accepts an `as="div" | "section"`
  prop so callers keep `<section>` where it's a real page landmark
  rather than force every card into a generic `<div>`. Controls
  (buttons, inputs, selects) bumped from bare `rounded` to `rounded-md`;
  cards to `rounded-xl`; `GatedSection`'s dashed "locked" placeholder to
  `rounded-lg` (kept dashed and shadow-less deliberately — it's not a
  real card, the visual distinction from `Card` is the point). Hover
  states across buttons, links, and inputs gained `transition-colors`
  (there was no existing `transition-*` usage anywhere in the app
  before this — a clean addition, not a change to any established
  convention).
- **Layout width**: `PageContainer` gained a `size?: 'narrow' | 'wide'`
  prop — `narrow` (`max-w-2xl`, the default, unchanged) for every
  form-shaped page (wizard, login, admin login, verify, my-reviews);
  `wide` (`max-w-4xl`) for the four data-heavy pages (search, company
  profile, analytics, moderation queue). `NavBar`'s own inner wrapper —
  previously independently hardcoded to `max-w-2xl` — now matches the
  wide value, so the nav bar never looks narrower than the page
  content below it regardless of which size a given page uses; it also
  gained a real surface (`bg-white`/`dark:bg-gray-900`) instead of
  relying solely on its bottom border, consistent with the new page
  background giving it something to contrast against.

**Not a redesign** — no new color palette, no brand mark/logo, no
change to any page's actual layout structure or information hierarchy.
Every change here is a className-level swap plus two small,
single-purpose components (`Card`, the `PageContainer` size prop) — the
kind of change deliberately chosen to be mechanical and low-risk rather
than something requiring new architecture.

**Revisit when:** color-palette expansion and a real brand mark, if the
user wants to pursue a second design pass — both were scoped out here
specifically because they're subjective taste calls rather than
mechanical fixes.

---

### D42 — Button color variants and a brand mark (GitHub issue #236, Phase 23)

**Context:** the two directions D41/Phase 22 deliberately scoped out
as design-taste calls rather than mechanical fixes — color-palette
expansion and a real brand mark.

**Decision:**
- **Color**: no new arbitrary accent hue was introduced. Instead,
  `Button` gained a `variant?: 'primary' | 'danger' | 'neutral' |
  'warning'` prop, formalizing colors already in use throughout the
  app (indigo for primary actions, red for destructive ones, gray for
  cancel/secondary, amber for the moderation "flag" action) rather than
  the identical `className="bg-red-600 hover:bg-red-700"`/
  `"bg-gray-600 hover:bg-gray-700"` overrides duplicated independently
  across `me/page.tsx` (7 sites) and `moderation/page.tsx` (3 sites,
  including the one `bg-amber-600` "Flag" button). `Button` and the
  repeated text-input class strings across the app also gained visible
  `focus`/`focus-visible` ring styling — a real missing piece of
  keyboard-accessible interactive polish, not decoration.
- **Brand mark**: a small inline SVG (`BrandMark.tsx` — a rounded
  indigo badge with a star, tying into the product's core "rating"
  concept), placed beside the "Interview Insights" wordmark in
  `NavBar`, and reused as the site favicon via Next.js's `app/icon.svg`
  file convention (auto-served, no metadata config needed). No
  external image asset or network dependency — the same self-contained
  approach `next/font/google` already established for typography (D41).

**Revisit when:** if a future design pass wants a more elaborate
brand identity (a distinct logotype, more than one mark) — this is a
lightweight, functional placeholder, not a final brand system.

---

### D43 — CD's disk-pressure fix (D35) didn't cover the kind node's own containerd store; a keep-set-aware prune script does (GitHub issue #240)

**Context:** a CD run failed the same night — same crash signature as
D35 (OpenSearch `cluster_block_exception` from a tripped flood-stage
watermark), same underlying cause (disk pressure on the self-hosted
runner), but a genuinely different disk than D35's fix touches. `cd.yml`'s
"Prune stale Docker artifacts" step (D35) only prunes the *host* Docker
Desktop cache. `kind load docker-image` copies the built image into the
**kind node's own internal containerd store** and retags forward,
never removing the layers the previous build left there — a completely
separate location the host-level prune never reaches. One unusually
heavy day (Phases 20-23, ~8 rebuild+`kind load` cycles for live
verification) pushed the node's own filesystem to 91% full, tripping
the same watermark again. Confirmed directly: `crictl images` on the
node showed 48 images totaling 27GB, overwhelmingly untagged
`import-2026-07-*` entries — exactly what `kind load`'s retag-forward
behavior produces over many rebuilds.

**Decision:**
- New `infra/scripts/prune-kind-node-images.sh`, wired into `cd.yml` as
  a second `if: always()` prune step alongside D35's host-level one.
  Deliberately **not** a blind `crictl rmi --prune` — D35's own
  near-miss already documented why: kubelet/containerd track a running
  container by image digest, not tag, so a tag moving forward to a new
  build can leave an already-running pod depending on a digest no
  longer reachable by any tag, and `--prune`'s "unreferenced" logic
  doesn't account for that. Confirmed live, not theoretically: at the
  time of this incident, both currently-running `api`/`web` pods *and*
  `ingress-nginx-controller` (the exact image D35's near-miss almost
  deleted) were each depending on a digest only reachable via one of
  the untagged `import-*` entries, since the `:k8s` tag had since moved
  past them.
- The script instead computes the set of image digests currently in
  use by any pod in any namespace (the real source of truth for "safe
  to delete," not just this app's own namespace) and removes only
  node-side images that are both untagged and outside that keep set.
- Also found live: `crictl rmi` doesn't reclaim disk immediately on its
  own — a deletion reports success without `df` reflecting it until
  `containerd` itself is restarted, which triggers the actual
  garbage-collection pass. Confirmed directly: a single deletion plus a
  prior `systemctl restart containerd` measurably freed disk once
  combined; either alone measured zero change. The script restarts
  containerd after removing images — already-running containers
  survive this, since it restarts only the management daemon.

**Verified live**: ran the script against the actual incident (node at
91% full) — it correctly removed every genuinely-orphaned image while
leaving the then-running `api`/`web`/`ingress-nginx-controller` images
untouched, freed disk to 45%, cleared OpenSearch's blocks, and the
subsequent rollout succeeded. Re-ran afterward against the now-clean
cluster and it correctly found and removed only the single image
orphaned by that same rollout's own pod termination.

**Revisit when:** if this recurs despite the fix — would mean the
keep-set computation has a gap (e.g., a pod in `Pending`/
`ContainerCreating` with no `imageID` yet, referencing an image about
to be pruned out from under it) worth hardening against.

---

### D44 — Manual test-data cleanup left stale moderation-queue entries and a stale OpenSearch company index; a checklist, not a code fix

**Context:** a user report of "stale, unactionable records" in the
moderation queue and company search, traced to Phase 21's (issue #226)
live-verification cleanup earlier the same night. That verification
seeded real content through the actual API (candidate login → company
→ process → round ratings → overall review) so indexing/moderation
would behave realistically, then approved it directly via raw SQL
(deliberately, to avoid re-testing the moderation flow itself — see
that phase's own blog post) and cleaned up afterward with direct
`DELETE FROM companies/interview_processes/rounds/round_ratings/
overall_reviews/candidates` statements against Postgres.

That cleanup mirrored the *create* side effects (real API calls, so
real indexing/queue entries) but not the *delete* ones — because there
is no real "delete a company" or "delete an already-SQL-approved
rating" path in the app to mirror. Confirmed directly: 5 orphaned
`moderation_queue` rows (their underlying `round_rating`/
`overall_review` rows fully gone from Postgres) and 4 stale OpenSearch
`companies` documents (their source rows also fully gone) — not a
production code bug. Every *real* delete path in this app —
`RoundRatingsService.remove()`/`OverallReviewService.remove()` (issue
#150) and `MeService.eraseMe()` (GDPR erasure, issue #151) — already
correctly cleans up both `moderation_queue` and the OpenSearch index
themselves. The gap only exists when something bypasses the app
entirely via raw SQL, which is exactly what ad hoc live-verification
work in this project does routinely.

**Decision:** not a code fix — there's no application bug to fix, and
adding defensive auto-pruning to `ModerationService.listPending()` for
this specific, self-inflicted scenario would be solving a problem this
project's own verification habits created, not one real usage
produces. Instead, a permanent checklist in
`wiki/deployment-guide.md` (section 6.2): any manual test-data cleanup
via direct SQL must also explicitly clean up `moderation_queue`
(`DELETE FROM moderation_queue WHERE entity_id IN (...)`, gathered
*before* deleting the entities themselves, since the ids are needed for
the query) and the OpenSearch `companies` index (`DELETE
/companies/_doc/<company id>` — note the document id is the company's
UUID, not its slug, confirmed directly after an initial attempt to
delete by slug silently no-op'd with `"result":"not_found"`), plus a
reminder that OpenSearch's `_search` results can lag a `_delete` by up
to its refresh interval — call `POST /<index>/_refresh` before treating
a "did my cleanup work" check as authoritative, or the deletion can
look like it silently failed when it didn't.

**Revisit when:** if this class of test-data residue becomes frequent
enough that a small internal-only cleanup script
(`infra/scripts/prune-test-companies.sh`, mirroring
`prune-kind-node-images.sh`'s shape) is worth building — not justified
yet for a handful of one-off incidents.

---

### D45 — `round_ratings` interviewer traits reduced to fluency/clarity/focus (GitHub issue #247, Phase 24)

**Context:** a UI/UX brainstorm asked to streamline what's collected per
round rating, limiting interviewer traits to three specific ones —
fluency (communication), clarity (of the problem statement), and focus
(attentiveness during the interview) — rather than the original five
generic fields (`difficulty`, `fairness`, `communication_fluency`,
`attentiveness`, `bias_signal`).

**Decision:**
- `difficulty` stays unchanged — it's an axis about the round/problem
  itself, not the interviewer, and was never in scope for this
  reduction.
- `communication_fluency`→`fluency` and `attentiveness`→`focus` are
  true renames (the migration uses `RENAME COLUMN`, preserving any
  existing data, even though the table was empty at the time this
  shipped).
- `fairness` and `bias_signal` are dropped outright — neither maps
  onto the new three-trait list. `clarity` is genuinely new.
- `technical_depth` is unchanged (still optional) — out of scope for
  this reduction, though it may eventually fold into round-type
  `type_metadata` (issue #248) instead of staying a generic column.
- `company_round_type_aggregates` (the materialized view, issue #7)
  is dropped and recreated with the new column set — Postgres won't
  let you `ALTER` a column a view depends on, so the view has to go
  first and come back after.
- Every consumer (DTOs, services, the wizard, `/me`, the company
  profile page, the analytics dashboard, `docs/DATA_MODEL.md`) was
  updated in the same pass — this was a genuinely cross-cutting
  rename, not additive, exactly because the fields were being
  *reduced*, not expanded alongside the old ones.

**Revisit when:** if `technical_depth` should move into round-type
`type_metadata` (issue #248) instead of staying a generic column —
deferred, not decided here.

---

### D46 — A candidate can delete an entirely-empty process (GitHub issue #260, Phase 17)

**Context:** live-verifying issue #247 surfaced real `/me` clutter: an
`InterviewProcess` with a `Round` created but abandoned before ever
submitting a rating shows "No ratings submitted for this process yet."
forever, with no way to remove it. Issue #150 had already decided,
deliberately, that Update/Delete stays scoped to the three moderated
content types only — "never the structural entities," since there's
no moderation status on a structural entity to protect. That reasoning
is still correct for what #150 was actually about. This is a different
concern: a person's own content-free, abandoned data shouldn't be
permanently stuck with no cleanup path at all.

**Decision:**
- New `DELETE /processes/:id`, gated by `CandidateJwtAuthGuard`, same
  ownership pattern as `RoundRatingsService.remove()` (404 if not
  visible, 403 if owned by someone else).
- Only succeeds when the process is genuinely empty — zero round
  ratings, zero recruiter ratings, no overall review, across **every**
  status. A still-`pending`, unmoderated rating counts as real content
  — there's something to lose, so it's out of scope here exactly as
  much as an approved one. Otherwise: 409 Conflict.
- Deletes the process's (empty) rounds and recruiter interactions
  along with it. No `moderation_queue` cleanup needed — an empty
  process by definition never enqueued anything.
- `/me` shows a "Delete process" button only in the exact spot it
  already showed "No ratings submitted for this process yet." — same
  `window.confirm`-gated pattern as every other delete on that page.
- Deliberately narrower than issue #150, not a reversal of it: #150 is
  about not letting edits undermine moderation; this is about not
  letting truly-empty data sit forever. The two decisions don't
  actually conflict, they're just answering different questions.
- Structurally superseded once Phase 26 (client-side draft wizard)
  ships — an abandoned draft will never reach the database at all.
  This stays useful afterward too, for whatever residue Phase 26
  doesn't fully prevent.

**Revisit when:** never expected to need revisiting — this is a
narrow, permanent capability, not a placeholder.

---

### D47 — Round-type registry expanded to all 8 round types; controlled-vocabulary values admin-managed, not hardcoded (GitHub issue #248, Phase 24)

**Context:** issue #248 as originally filed only structured
`type_metadata` for `coding`/`system_design`, with every other round type
staying free-form JSON indefinitely and any controlled-vocabulary values
(algorithm names, data structure names, etc.) hardcoded wherever they were
needed. Before implementation started, the project owner expanded the
scope directly: all 8 `RoundType` values should get structured schemas,
and the selectable values behind controlled fields should be admin-
manageable through a UI, not hardcoded — with a new phase for that
admin gateway.

**Decision:**
- All 8 round types (`coding`, `system_design`, `behavioral`,
  `leadership`, `case_study`, `assessment`, `take_home`, `other`) get a
  structured `type_metadata` schema, defined once in
  `api/src/round-type-registry/round-type-field-schema.ts` — a single
  static config mapping round type → field list → `text`/
  `controlled-single`/`controlled-multi` kind. `other` deliberately gets
  no controlled field (only a free-text `notes` key) — it's the
  catch-all round type by definition, so there's no sensible fixed
  vocabulary to constrain it with.
- Controlled-vocabulary values live in a new `round_type_field_options`
  table (`round_type`, `field_key`, `value`, `sort_order`, `is_active`),
  not in the static registry config — this is what makes them
  admin-editable later without a code change. `is_active` (not a hard
  delete) so retiring a value never invalidates `type_metadata` that
  already reference it.
- **Read/write split across two phases, not built together:** this
  issue builds only the read side — the registry, semantic validation,
  and a public `GET /round-types/field-options` — plus seeds
  illustrative default values via migration so Phase 25/26 aren't
  blocked waiting on an admin UI to populate the table. The write side
  (admin CRUD over `round_type_field_options`, reusing `AdminJwtAuthGuard`
  exactly as `ModerationController` does, plus an admin UI page) is a
  new, separately-planned **Phase 27 — Admin Content Gateway**, filed
  alongside this issue but implemented after Phase 25/26 since nothing
  downstream depends on it existing yet.
- **Validation lives in `RoundsService.create()`, not an async DTO
  validator** — matches this codebase's existing pattern of putting
  business-rule validation in services (`FraudChecksService`,
  `ModerationService`), not class-validator custom validators.
  `CreateRoundDto.typeMetadata` keeps its existing `@IsObject()`
  shape-only check; the service rejects (400) an unknown key for the
  round type, or a controlled value that isn't currently `is_active`.
- This issue deliberately does **not** touch the current wizard
  (`web/src/app/page.tsx`) — issue #248's own original body already
  framed the frontend config object as what Phase 26/issue #254's
  wizard rewrite reads from, not this issue's job, and building that UI
  twice (now, then again in Phase 26's rewrite) isn't worth it.

**Revisit when:** Phase 27 ships — at that point `is_active` retirement
and reordering become real admin actions instead of migration-only
seed data.

---

### D48 — `recruiter_ratings` field redesign: responsiveness merge, reachability reinterpretation, guidelines_shared, nullable self-reported rejection_message_authenticity (GitHub issue #249, Phase 24)

**Context:** issue #249, unlike #247's clean 1:1 rename, had five real
open questions left unresolved when originally filed. Resolved directly
with the project owner (kickoff brainstorm, same pattern Phase
16/17/21 each used) before any implementation.

**Decision:**
- `response_time` + `timeliness` merge into one `responsiveness` field
  — a candidate can't cleanly separate "replied fast" from "kept to
  promised dates" in a single rating anyway, the same reasoning #247
  used to drop `fairness`/`bias_signal` as overly-correlated axes.
  `response_time`'s column is renamed (data-preserving); `timeliness`
  is dropped outright.
- `communication_quality` is dropped entirely, not kept as a 5th
  field — its signal folds into `reachability`/`responsiveness`/the
  free-text field, matching the issue's own 4-field target exactly.
- `reachability` is a rename + reinterpretation of `approachability`
  (`RENAME COLUMN`, data-preserving), not a new additional field — the
  meaning shifts from "were they pleasant/friendly" to "could you
  actually get hold of them when needed."
- `guidelines_shared` is a 1-5 rating, not a boolean — keeps every
  `recruiter_ratings` column uniform (`NOT NULL SMALLINT`,
  `CHECK 1-5`), 1 meaning "none/unhelpful" and 5 "extremely helpful."
- `rejection_message_authenticity` is a **nullable** 1-5 column,
  self-reported, with **no backend gating** against
  `interview_processes.outcome`. `RecruiterInteraction` has no outcome
  link of its own (outcome lives on `InterviewProcess`, and a process
  can have many recruiter interactions), so enforcing "only when
  `outcome = 'rejected'`" would need an extra join and risks a race —
  the interaction can be logged before the process outcome is
  finalized. The wizard just offers it as an optional field the
  candidate fills in by their own judgment. Deliberately excluded from
  `company_recruiter_aggregates` and `AnalyticsService`'s
  shrinkage-scored output — same precedent `round_ratings.
  technical_depth` (also nullable) already set: optional fields stay
  out of the aggregation layer, visible only via raw per-rating reads
  (`MeService`, `ModerationService`).
- Final field set: `reachability`, `responsiveness`,
  `guidelinesShared`, `rejectionMessageAuthenticity` (nullable) —
  matches the issue's originally-proposed 4-field target exactly.
  Migration mirrors #247's shape: drop the dependent materialized view
  first (`company_recruiter_aggregates`), rename/drop/add columns,
  recreate the CHECK constraints under matching names, recreate the
  view.

**Revisit when:** never expected to need revisiting — the field
semantics are settled; only Phase 26's wizard rewrite will change how
they're collected, not what they mean.

---

### D49 — Bulk process-submission endpoint: one atomic transaction, no partial success (GitHub issue #251, Phase 25)

**Context:** issue #251 asked for a single endpoint that creates an
entire interview-process tree (process, rounds+ratings, recruiter
interactions+ratings, overall review) in one call — the backend
counterpart Phase 26's draft wizard needs before it can submit a
draft for real. The issue's own Scope section flagged one thing to
"decide during implementation": whether a bulk submission that would
trip something (originally framed around D13's rate limit) should
roll back the whole transaction or partially succeed.

**Decision:**
- The entire tree is created inside one `prisma.$transaction()`. Any
  failure — a DTO validation error, a round-type registry rejection
  (D47/#248), a database constraint violation — rolls back everything
  Postgres has touched so far in that transaction. Nothing partially
  commits; a failed bulk submission leaves zero rows behind. This
  matches the issue's own verification-plan wording ("partial failure
  rolls back everything — no orphaned rows") and standard `$transaction`
  semantics already used by every other write path in this codebase.
- On closer look, D13's fraud/rate-limit checks were never actually a
  rollback candidate at all: `FraudChecksService` never blocks a
  write, it only attaches a `flagReason` to the moderation_queue entry
  (D13 itself documents this). So there's no scenario where hitting
  the rate limit inside a bulk call causes anything to fail — every
  round rating in the payload still gets created, just possibly
  flagged. What genuinely can fail and trigger a rollback is a real
  validation/constraint error on any nested entity (an out-of-range
  rating, an invalid `type_metadata` value, etc.).
  Because `FraudChecksService.checkRateLimit()` counts rows via the
  same transaction client (`tx`) passed through the whole bulk create,
  and round ratings are created **sequentially, not in parallel**,
  each round's fraud check correctly sees every sibling round rating
  already inserted earlier in the same bulk call — the rolling-window
  count is accurate within a single submission, not just across
  separate requests.
- Existing per-entity endpoints are untouched — this is an additive
  path, not a replacement, exactly as scoped.

**Revisit when:** never expected to need revisiting — full-transaction
atomicity is the only sensible semantics for "submit one interview
process as a unit."

---

### D50 — Client-side draft store: one localStorage blob, no candidateId, feature-detected id generation (GitHub issue #253, Phase 26)

**Context:** issue #253 needed a client-side draft store — the first
use of any browser persistence anywhere in `web/` (confirmed zero prior
`localStorage`/`sessionStorage` usage). A few small implementation
decisions had no existing pattern to follow.

**Decision:**
- **One versioned localStorage key** (`interview-insights:drafts:v1`)
  holding `Record<string, ProcessDraft>`, not one key per draft plus a
  separate index. A candidate has at most a handful of drafts at once —
  a single JSON blob is simpler and avoids an index that could drift
  out of sync with the keys it's supposed to track.
- **A draft never stores `candidateId`.** It's pure client-side state
  belonging to whoever's browser it's in; the real `candidateId` is
  only ever attributed server-side, at issue #255's bulk submit, from
  the authenticated session — same no-client-supplied-identity rule
  every other write path in this app already follows (D31).
- **Draft editing itself requires no session at all** — only creating a
  *new* company (already session-gated, D38) and the eventual bulk
  submit (issue #255) do. An anonymous visitor can pick an existing
  company and build up an entire draft; the login prompt only appears
  when it actually matters. This falls directly out of the design
  (nothing about editing a draft touches the network) rather than
  being a deliberately engineered feature.
- **`crypto.randomUUID()` needed a fallback, and not just for tests.**
  It requires a secure context — true in jsdom (whose `crypto` shim
  doesn't implement the method at all) but also true in every real
  deployed environment this project has today: plain HTTP on a
  non-`localhost` origin (D27, no TLS yet). A feature-detected
  `generateId()` (real UUID when available, a timestamp+random string
  otherwise) is the correct fix in both places at once — a client-only
  draft/step id has no security requirement that would demand a real
  UUID anyway.
- **Recruiter touchpoint chronological placement is a plain
  `'start' | 'end'` field, client-only, never submitted.** Directly
  realizes issue #254's own "Recruiter — Start"/"Recruiter — End"
  vocabulary for the review screen (issue #255) to sort by, instead of
  inventing a numeric position scheme the candidate would have to
  manage by hand.

**Revisit when:** if a real need for cross-device draft sync ever
surfaces — out of scope today, explicitly called out in issue #253 as
"a local-only convenience, not a server-side save."

---

### D51 — Orphaned OpenSearch company documents get a script, not just a checklist (GitHub issue #278, Phase 20)

**Context:** `/search` was returning obviously-duplicated, meaningless
company results ("Profile Co" ×20 and a few similarly-named others). A
direct diff against Postgres found the real scale of it: the
`companies` OpenSearch index had 420 documents against only 5 real
rows — 415 orphans with no backing company at all.

**Root cause:** OpenSearch indexing (D16) only happens on company
*creation* — there is no `DELETE /companies` endpoint, since companies
are shared across candidates and never deleted through normal app
usage. The only thing that has ever deleted a company row is a manual
`DELETE FROM companies` during live-verification test cleanup (D44's
documented pattern, used constantly throughout this project's
history). That cleanup only ever touched Postgres — nothing re-synced
the index afterward. D44 already documented the correct manual step
(delete the OpenSearch doc by the company's UUID,
`wiki/deployment-guide.md` section 6.2) — the gap wasn't a missing
instruction, it's that a purely manual step, repeated across dozens of
ad hoc verification sessions over many phases, was evidently skipped
often enough to accumulate 415 ghosts.

**Decision:**
- Deleted the 415 confirmed orphans directly (full ID diff against
  Postgres first — zero false positives, every real company's
  OpenSearch doc was preserved) — the index now matches Postgres
  exactly, 5 documents each.
- Added `api/scripts/prune-orphaned-company-search-docs.js`: diffs the
  `companies` index against Postgres and bulk-deletes anything with no
  matching row, with a `--dry-run` mode. Exposed as
  `npm run prune:orphaned-company-search-docs` in `api/package.json`.
  Deliberately **not** wired into any automated job or CI step —
  company deletion is always a manual, deliberate test-cleanup action,
  so pruning its fallout stays manual and deliberate too; this just
  makes the existing D44 checklist step reliable instead of
  easy-to-forget.
- `wiki/deployment-guide.md` section 6.2 updated to point at the
  script as the recommended way to run step 3 (the OpenSearch cleanup
  step) — the manual walkthrough stays as the underlying explanation of
  what it's doing, not replaced.

**Revisit when:** never expected to need revisiting for the
`companies` index specifically. If a similar orphaning pattern ever
surfaces for the `reviews` index (round ratings indexed via
`ReviewSearchService`), note that one already has a real removal path
(`removeReview()`, wired into `RoundRatingsService.remove()`, D17) —
so it shouldn't be susceptible to the same class of gap, but worth
checking if it ever is.

---

### D52 — Fraud-check rate limiting moves from counting entities to counting submissions (GitHub issue #317, Phase 29)

**Context:** while reviewing #315's moderation-queue grouping-by-
submission work, the project owner asked a sharper question:
should moderation and rate-limiting be scoped per-entity (per round/
recruiter rating, per overall review) or per-submission (per
`InterviewProcess`)? The two concerns turned out to have different
correct answers.

**Moderation actions (approve/reject/flag): stay per-entity, no
change.** Live data from #315's own verification proved why — a real
submission had 3 coding-round ratings, 2 clean and 1 auto-flagged
`rate_limit`. A moderator needs to approve the 2 good ones and handle
the 1 suspicious one separately; acting on the whole submission at
once would force an all-or-nothing call that either loses legitimate
content or waves through suspicious content alongside it.

**Rate limiting: reframed, not just extended.** `FraudChecksService.
checkRateLimit()` (D13) counts `round_rating` rows created by a
candidate in a rolling 24h window — 3 trips the flag. But Phase 25/26
built this platform specifically so one legitimate submission can
contain several round ratings (a real multi-round interview loop).
Counting per-entity means a single genuine submission can trip its
own "abuse" signal — exactly what the live data showed: the 3rd round
rating in one real 5-entity submission got auto-flagged purely for
being the candidate's 3rd rating that day, not because anything about
it was actually suspicious. The unit being counted was wrong, not just
incomplete (it also never covered recruiter ratings/overall reviews,
#317's original ask).

**Decision:**
- Replace the entity-count rate limit with a **submission-count**
  one: count `InterviewProcess` rows the candidate has created in the
  rolling 24h window, not individual round/recruiter/overall rows. One
  interview loop with 5 rounds is 1 event under this model, not 5.
- Apply this same submission-level check uniformly when creating any
  of the three entity types (round rating, recruiter rating, overall
  review) — every entity belonging to an over-the-limit submission
  gets flagged `rate_limit` on its own moderation_queue entry, never
  blocking the write (unchanged from D13).
- This resolves #317's original kickoff question (shared vs. per-type
  counter) by making it moot: there is exactly one counter
  (submissions), and it doesn't depend on which entity type is being
  created within a submission.
- Duplicate free-text detection (the other half of
  `FraudChecksService`, unrelated to the count-based limit above)
  extends to `recruiter_rating.freeText` and
  `overall_review.reviewText`, each compared only within its own
  field/entity type — a straightforward mechanical extension, not
  part of the rate-limit reframing.

**Revisit when:** if real usage ever shows legitimate candidates
submitting more than ~3 genuinely separate interview processes in a
day (e.g. someone actively interviewing at several companies at once)
— the threshold, not the unit, would be the thing to tune then, same
placeholder-value spirit as D13's original constant.

---

### D53 — Revisiting D12: a real event bus, deliberately scoped, for microservices/distributed-systems practice (Phases 30-32)

**Context:** D12 documented a deliberate choice to keep moderation
in-process rather than event-driven — "no async load yet to justify
decoupling it." That reasoning hasn't changed: there still isn't
organic load driving this. What's new is a different, equally
legitimate kind of trigger — the project owner explicitly wants real
distributed-systems/microservices practice (notification-service,
review-analyzer, and, discussed but deliberately not phased,
moderator-service), the same category of trigger Phase 10/11 already
accepted for LocalStack IAM/secrets work ("free/local practice for
Phase 8's eventual real AWS work," not organic need). D12 itself isn't
wrong to revisit — its own text never claimed the decision was
permanent, only that nothing was asking for it *yet*.

**Decision:**
- Introduce a real message broker (Redpanda) for the first time in
  this project (Phase 30) — but scoped narrowly and additively: a
  best-effort, after-commit event-publishing pattern, matching D16/D17's
  already-proven "never block the write" philosophy for OpenSearch
  indexing exactly. The synchronous write path itself — `RoundRatingsService.
  create()`'s `$transaction` including `ModerationService.enqueue()` —
  is **unchanged**. This is new plumbing for new downstream consumers,
  not a rewrite of anything that already works. D12's core reasoning
  (moderation's own write is transactionally safer in-process) still
  holds and isn't being reversed.
- Build exactly two new consumers, in a deliberately conservative
  order: **notification-service** first (Phase 31) — the lowest-risk
  extraction, since `mail/` is already a clean-boundary module with no
  write-path dependencies, proving the whole pattern (broker, a real
  out-of-cluster consumer, independent deployment, idempotent
  consumption) end to end before anything riskier. **review-analyzer**
  second (Phase 32) — deliberately sequenced *after* Phase 19 issue
  #163 (LLM-assisted moderation triage) is already built in-process,
  so the analysis logic and the service-extraction plumbing aren't
  both being invented at the same time; review-analyzer becomes a
  secondary, arrives-later enrichment alongside the existing
  synchronous `FraudChecksService` signal, never a replacement for it
  (final call deferred to that phase's own kickoff brainstorm, issue
  #338).
- **Moderator-service is explicitly not phased.** `ModerationService`
  is already a clean bounded context inside the monolith, and Phase 29
  just reshaped its query for exactly this reason — no concrete trigger
  (independent scaling/deployment need) has fired for splitting it out.
  Left as a documented backlog note, same trigger-gated treatment
  Phase 8's own menu already uses for its sub-areas.
- The first real Kafka/Redpanda consumer (Phase 31) fires
  `docs/ROADMAP.md` Phase 8's own sub-area 8g trigger ("Distributed
  systems hardening... the first real Kafka/Redpanda consumer existing
  at all — none does yet") for the first time. That gets its own
  planning pass under Phase 8's existing menu structure once Phase 31
  actually ships — not pre-filed here, per Phase 8's own "plan one
  sub-area at a time, only once its trigger fires" convention. Phase
  8f (observability/tracing) does **not** get triggered by this —
  its own stated trigger ("first shared/staging deployment with real
  traffic") still hasn't fired; this stays solo local `kind`.

**Revisit when:** if either new service's operational cost (another
thing to run, patch, debug, deploy) turns out not to be worth the
practice value, that's a legitimate reason to fold it back into the
monolith — same as any other D9-style "premature infrastructure"
call, just running in the opposite direction from usual (accepting
complexity deliberately, for a stated non-functional reason, rather
than deferring it).

---

### D54 — Public company Reviews section groups approved round ratings by submission (GitHub issue #347, Phase 20)

**Context:** a user live-usage report — the same flat-list problem
Phase 29 issue #315 already fixed for the moderation queue, now spotted
on the public-facing company profile page. `GET /companies/:id/reviews`
listed every approved `round_rating` as its own row and labeled the
count "N reviews"; a single interview loop with 3 rated rounds (2
coding + 1 tech screening, all one submission) inflated the visible
count to include itself 3 times over, alongside one genuinely separate
submission — 4 rows read as "4 reviews" when it was really 2.

**Decision:**
- Group approved round ratings by their parent `InterviewProcess` in
  application code (`CompaniesService.findApprovedReviews()`) — the
  same `Map`-keyed grouping shape `ModerationService.listPending()`
  already uses (#315), and the same accepted full-table-scan tradeoff
  D13 already established for fraud-check duplicate detection: fine at
  today's volume, revisit if a company's review count ever makes this
  measurably slow.
- **Pagination moves with the grouping, not just the display.**
  `total`/`page`/`pageSize` now describe submissions, not raw rows —
  paginating over raw rows first and grouping the current page's rows
  afterward would risk splitting one submission's rounds across a page
  boundary, showing half a submission on page 1 and the rest on page 2.
  Rows are fetched unpaginated, grouped, then the *group* array is
  sliced for the requested page.
- `CompanyReviewItem` (the frontend type) dropped `roleTitle` — it
  moved to the new group-level `CompanyReviewGroup.roleTitle`, since
  every round in one submission shares the same role. The company
  profile page renders one collapsed card per group (role title + a
  real round count), expanding on click to reveal each round's full
  detail — reusing Phase 21's existing `GatedSection` soft-gating
  (D40) unchanged, since gating a group of entries works identically to
  gating a group of one.
- The "N reviews" count phrasing itself is unchanged — only what it
  counts changes, matching exactly what was reported: "each submission
  is 1 review."

**Revisit when:** never expected to need revisiting — this closes the
same class of gap #315 already closed for the admin-facing queue, on
the last remaining flat list in the app.

---

### D55 — `/me` labels a process's own outcome distinctly from moderation status (GitHub issue #349, Phase 20)

**Context:** a user live-usage report on the `/me` page: each process
card shows `InterviewProcess.outcome` (`offer`/`rejected`/`withdrawn`/
`ghosted`/`in_progress` — the candidate's own self-reported result of
the interview process) as a bare word, right alongside up to five
nested moderation statuses (round ratings, recruiter rating, overall
review — each independently `approved`/`pending`/`rejected`/`flagged`).
The two fields share overlapping vocabulary by coincidence, not
design — a process outcome of `rejected` displayed as a bare
"Rejected" reads exactly like a sixth moderation verdict, especially
confusing when it's the *opposite* of what every real moderation
status on the same card said.

**Decision:** prefix the label — `Outcome: Rejected` instead of a bare
`Rejected` — making the field's meaning explicit. Copy-only change, no
data or behavior difference.

**Revisit when:** never expected to need revisiting — a one-line label
fix.

---

### D56 — Landing page (/) and wizard (/search) swap places; company selection moves upstream of the wizard entirely (GitHub issue #352, Phase 33)

**Context:** a deliberate product-direction request — the landing page
should be for searching/browsing reviews, the primary verb this
platform is actually about for most visitors, not writing one. Same
category of direct, confirmed pivot Phase 21 (anonymous visitor
soft-gating) already used as precedent for getting its own phase
rather than folding into Phase 20's operational-hardening epic.

**Decision:**
- Swap `web/src/app/page.tsx` and `web/src/app/search/page.tsx`'s body
  content wholesale: `/` becomes the two-step company/review search
  experience (previously at `/search`), `/search` becomes the
  write-a-review wizard (previously at `/`). Routes/file locations are
  unchanged — only which component each renders.
- The new `/` gains a quick-select company-button grid (every existing
  company, one click) alongside the existing text search — the exact
  visual/interaction pattern the wizard's old company picker used,
  relocated here since discovery is this page's job now.
- The wizard's own former company-picker button grid is removed
  **entirely**, not kept as a fallback. Company selection for a new
  draft happens upstream instead: a new "Write a review" link — on a
  selected search result and on a company's public profile page
  (`/companies/:slug`) — navigates to `/search?companyId=...&
  companySlug=...&companyName=...`. The wizard reads these on mount to
  either resume an existing draft for that company (matched by
  `companyId` against `listDrafts()`) or start a fresh one, then
  strips the params via `router.replace('/search')` so a later reload
  lands on the plain drafts list rather than repeating the auto-start.
  The wizard's remaining "Start a new draft" section is only the
  create-a-genuinely-new-company form now.
- `NavBar`'s "Search companies & reviews" link is relabeled "Write a
  review" — still pointing at `/search`, which now hosts the wizard;
  no separate nav entry was added for search, since the brand-mark
  Home link already goes to `/`, now the search/discovery experience.
- `useSearchParams()` requires the consuming component to sit inside a
  `<Suspense>` boundary in the Next.js App Router (a hard build error
  otherwise) — same pattern `auth/verify/page.tsx` already established
  for the same hook; the wizard's default export wraps its real content
  component for exactly this reason.

**Testing note worth recording:** a naive test mock of
`useSearchParams()` returning `new URLSearchParams(...)` fresh on every
call creates a new object reference every render, which re-triggers
the company-handoff `useEffect` on every re-render (not just mount) —
surfaced as a real test hang, not a flake. Fixed by returning a stable,
module-level `URLSearchParams` instance from the mock instead, matching
how real Next.js actually memoizes `useSearchParams()`'s return value
across re-renders when the URL hasn't changed.

**Revisit when:** never expected to need revisiting — this is the
platform's primary navigation shape now.

---

### D57 — Wizard moves again, off /search onto /write-review; drafts list gets its own login-gated /drafts route (GitHub issues #358-359, Phase 34)

**Context:** D56 (Phase 33) had already moved the wizard from `/` to
`/search`. A follow-up batch of five UI/UX requests asked to make
`/search`'s result rows homogeneous with "Browse reviews"/"View
profile"/"Write a review" actions (issue #357) — which meant `/search`
needed to go back to being purely the search/browse experience, not
also secretly host the wizard. Rather than swap a third time, the
wizard gets a genuinely distinct route, `/write-review`, and `/search`
stops existing as a route at all (browse/search already lives at `/`
since D56 — no need for a duplicate). Resolved directly with the
project owner: (1) drafts visibility should be gated behind candidate
login even though a draft is just localStorage, not a real session —
"keep it in such a way that they're not exposed without user login";
(2) a dedicated `/drafts` path was suggested and adopted, since no
existing route was a better fit; (3) the wizard must not keep living
at `/search` — it needed its own name.

**Decision:**
- `web/src/app/search/page.tsx` (the wizard, since D56) is moved to
  `web/src/app/write-review/page.tsx`; the now-empty `search/`
  directory is deleted. `/search` no longer exists as a route.
- `/write-review` keeps every existing wizard behavior (rounds,
  ratings, recruiter steps, review screen, bulk submit, session-expiry
  warning, add-round modal) unchanged, but its "no company context"
  state is narrowed to exactly one action: redirect to `/`. The old
  inline drafts list and create-company form are removed from this
  page entirely — they don't belong on a route whose whole job is "a
  company or a draft was already chosen upstream."
- `/write-review` now accepts a second, alternative query param shape:
  `?draftId=X` (resume this exact draft by id) alongside the existing
  `?companyId=&companySlug=&companyName=` (start-or-resume by company)
  — `/drafts`'s Resume links use the former, every "Write a review"
  link elsewhere still uses the latter.
- A **redirect-loop bug**, found and fixed during implementation: after
  the query-param effect consumes context and calls
  `router.replace('/write-review')`, the resulting empty
  `URLSearchParams` re-triggers the same effect (D56 already flagged
  this hook fires on every params change, not just mount) — naively,
  this would then redirect home even though a draft is already active.
  Fixed with a `useRef` flag (`consumedContextRef`), not state,
  synchronously set the instant context is consumed and checked before
  the redirect-home branch — a ref is guaranteed visible on the very
  next synchronous read, where a state update could in principle lag
  behind the effect's next firing.
- New `web/src/app/drafts/page.tsx`: the drafts list, displaced from
  the wizard, gated with the existing `GatedSection` component (same
  visibility rule as `/me`'s "My reviews" and the wizard's own
  session-hint gates) — a presentation-layer gate only, since the
  underlying `listDrafts()`/localStorage read needs no session at all.
  NavBar gains a "My drafts" link (shown only when logged in, mirroring
  "My reviews") and loses its standalone "Write a review" link entirely
  — writing a review is always company-specific now, never a bare nav
  entry point.
- The create-company form, also displaced from the wizard, does **not**
  move to `/drafts` — it moves to issue #360's search-failure flow
  instead (not yet implemented as of this entry).

**Testing note (a repeat of D56's own lesson, applied again):** the
new `write-review-page.spec.tsx` mocks `useSearchParams()` with a
stable, reassignable module-level reference
(`mockSearchParams.current`), not a fresh `URLSearchParams(...)` per
call — required again here for the same reason D56 first documented,
plus RTL's `rerender()` (not `cleanup()` + a fresh `render()`) to
simulate "params get stripped, same component instance persists"
without resetting `consumedContextRef` and defeating the test.

**Revisit when:** issue #360 lands (the create-company-request flow,
redirecting to `/write-review?companyId=...` on success) — worth
confirming `/write-review`'s existing company-handoff logic needs no
change to serve a freshly-created company the same way it already
serves an existing one.

---

### D58 — Company creation moves behind moderation, reusing `ModerationStatus`; a rejected row is kept, not deleted (GitHub issue #369, Phase 35)

**Context:** `POST /companies` had never been moderation-gated — a real
gap predating Phase 16 (`Company` has no `candidateId`, so it was never
on that phase's write-path list; issue #217/D38 only added session +
rate-limit gating, not a moderation queue). Direct user feedback during
Phase 35 planning flagged this as a genuine violation of CLAUDE.md hard
constraint #2 ("every review/rating write goes through moderation
before it's public") and asked for it to be closed.

**Decision:**
- `Company` gets a real `status` column, reusing the existing
  `ModerationStatus` enum (`pending`/`approved`/`rejected`/`flagged`)
  rather than inventing a separate one or a parallel "request" table —
  mirrors `RoundRating`/`RecruiterRating`/`OverallReview` exactly. The
  row exists immediately on creation (`status: pending`, the schema
  default), just hidden from every public read until approved. Chosen
  directly with the project owner over a separate-request-record
  design specifically to reuse the existing pattern rather than add a
  new concept the schema doesn't have anywhere else.
- `ModerationEntityType` gains a fourth value, `company` — added in its
  own migration alongside the `status` column (both DDL-only, no data
  using the new enum value within the same migration, so — unlike the
  `tech_screening` two-migration split, issue #284 — this one didn't
  actually need to be split across two files; it just happens to be one
  migration doing two independent things).
- `CompaniesService.create()` now enqueues via `ModerationService`
  instead of calling `CompanySearchService.indexCompany()` directly;
  indexing moves to approval time (`ModerationService.review()`'s new
  `company` case), the same D16/D17 "index only what's actually public"
  shape every other search-indexed entity already follows.
- Every public read path (`findAll`/quick-select list, `findBySlug`,
  the existence checks backing `GET /companies/:id/reviews` and
  `GET /companies/:companyId/analytics`) filters to `status: approved`
  — a pending or rejected company 404s exactly like a company that
  doesn't exist, never leaking that a request is in flight.
- Creating an `InterviewProcess` (both the single and bulk endpoints)
  against a non-approved `companyId` is rejected with 404 — otherwise a
  candidate could write real review data against a company nobody else
  can see yet.
- **A rejected company's row is kept** (`status: rejected`), not
  deleted — a deliberate trade favoring an audit trail over slug
  reuse, decided directly with the project owner over the "delete,
  not anonymize" GDPR-erasure precedent (D34) that would otherwise
  seem like the obvious default. The slug stays permanently occupied
  unless an admin manually intervenes later; no such intervention path
  exists yet.
- A duplicate `POST /companies` request for a slug that already has a
  **pending** row gets a distinct, friendly 409
  ("this company has already been requested and is pending review —
  please check back later.") instead of the generic unique-constraint
  conflict — direct user feedback, checked via a pre-insert
  `findUnique` lookup in `CompaniesService.create()`. A duplicate of an
  **approved** company still gets the generic conflict (the company
  genuinely already exists); a duplicate of a **rejected** one is left
  as the same generic conflict for now, an explicitly unresolved
  question noted in the issue rather than guessed at.

**Test-suite impact:** every e2e spec that previously created a company
via a raw `POST /companies` and immediately used it (searched for it, or
created a process against it) needed an admin-approve step inserted —
16 existing spec files updated, plus two files (`analytics.e2e-spec.ts`,
a raw-Prisma seed helper) that seed a company directly via Prisma and
needed `status: 'approved'` set explicitly in the seed data, since they
bypass the API (and its default `pending` status) entirely — the same
class of "raw-Prisma seeding skips API-layer side effects" gap this
project has hit before (D51's search-indexing gap was the same root
cause). A new shared `test/support/companies.ts` helper
(`createApprovedCompany`/`createPendingCompany`/
`findCompanyQueueEntryId`) centralizes the create-then-approve dance so
it isn't duplicated per file. A new dedicated `company-moderation.e2e-spec.ts`
covers the gate's own business rules (hidden from every read path,
process-creation blocked, the rejected-row-kept behavior, the
duplicate-pending message) that don't fit naturally into any existing
file's narrative.

**Revisit when:** issue #372 (the confirmation-modal replacement for
issue #360's create-company auto-redirect) lands — that issue exists
specifically because a successful creation no longer means "ready to
use" now that this decision has shipped.

---

## Still open (revisit when you have more information)

- Exact `k` value for shrinkage scoring — needs real review volume to tune.
- Whether `company_overall_aggregates` should be sliced by role/level from
  the start or added later.
