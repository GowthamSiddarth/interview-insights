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

---

## Still open (revisit when you have more information)

- Exact `k` value for shrinkage scoring — needs real review volume to tune.
- Whether `company_overall_aggregates` should be sliced by role/level from
  the start or added later.
- Retention/deletion policy for moderation queue + rejected content (GDPR
  erasure path).
