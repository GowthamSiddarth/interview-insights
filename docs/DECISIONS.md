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

## Still open (revisit when you have more information)

- Exact `k` value for shrinkage scoring — needs real review volume to tune.
- Whether `company_overall_aggregates` should be sliced by role/level from
  the start or added later.
- Retention/deletion policy for moderation queue + rejected content (GDPR
  erasure path).
