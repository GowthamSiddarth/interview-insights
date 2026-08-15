# Data Model — Interview Insights Platform

This is the source-of-truth schema. Write migrations directly from this spec.
Do not hand-edit production schema — every change here should become a
versioned migration file.

## Design principles

1. **Anonymize identity, not accountability.** Interviewers and recruiters are
   stored as internal entities so ratings roll up correctly and dedupe across
   reviews — but they are never exposed publicly by real name. Public label is
   generated (`Interviewer A`, `Recruiter — Round 2`).
2. **Ratings are atomic rows, not pre-averaged.** Never store a running average
   on write. Always aggregate from raw rating rows so recomputation, backfills,
   and dispute-driven deletions stay correct.
3. **One rating per candidate per round/interaction.** Enforced with a unique
   constraint — prevents a single candidate inflating a score by rating twice.
4. **Type-specific fields live in JSONB**, not new columns per round type. A
   coding round wants `language_used`; a case-study round wants
   `framework_provided`. Don't grow the base table schema per type.
5. **Moderation status gates visibility everywhere.** Every user-generated
   table has a `status` (or joins to `moderation_queue`) and every public
   query filters on `status = 'approved'`.

---

## Core tables

### `companies`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text | |
| slug | text | for URLs. **Not** a plain unique column (GitHub issue #696, Phase 50, D104) — a Postgres partial unique index instead, scoped to `WHERE status IN ('pending', 'approved')`, so a rejected request no longer permanently occupies its slug. Prisma's schema DSL can't express a partial index, so this constraint exists only in the hand-authored migration, not as a matching `@@unique` in `schema.prisma` |
| industry | text | nullable |
| size_bucket | text | enum-like: `startup`, `mid`, `large`, `enterprise` |
| logo_url | text | nullable |
| status | text | enum-like (`ModerationStatus`, shared with round_ratings/recruiter_ratings/overall_reviews) — moderation gate, GitHub issue #369 |
| candidate_id | uuid FK → candidates | nullable (a seed/admin-created company has no requester). `ON DELETE SET NULL`, unlike every other candidate-owned FK in this schema — a company is shared platform data other candidates' rows may already reference, so a GDPR erasure of the requester anonymizes this reference rather than being blocked by it or cascading into deleting the company (GitHub issue #696) |
| created_at | timestamptz | default now() |

### `candidates`
Represents a reviewer. Kept minimal and pseudonymous.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| email_hash | text | unique — hashed (HMAC), never reversible |
| email_encrypted | text | nullable — reversible (AES-256-GCM), GitHub issue #335/D74. The one deliberate exception to "never store the plaintext email": notification-service needs an actual address to send to, and email_hash can never be reversed back into one. Decryptable only with EMAIL_ENCRYPTION_KEY, a secret distinct from EMAIL_HASH_SECRET. |
| verification_status | text | `unverified`, `email_verified`, `document_verified` |
| verified_at | timestamptz | nullable |
| created_at | timestamptz | |

### `interview_processes`
One per candidate's application loop at a company.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| company_id | uuid FK → companies | |
| candidate_id | uuid FK → candidates | |
| role_title | text | e.g. "Senior Backend Engineer" |
| level | text | nullable, e.g. "L5", "Senior" — free text, normalize later |
| department | text | nullable |
| application_date | date | nullable |
| outcome | text | `offer`, `rejected`, `withdrawn`, `ghosted`, `in_progress` |
| normalized_band | text | nullable — `entry`, `mid`, `senior`, `staff`, `principal`, `manager`, `director`, `exec`. Populated progressively, see below. `unmapped` is a valid value — never guess. |
| created_at | timestamptz | |

Index: `(company_id, role_title)`, `(company_id, created_at)`, `(normalized_band)`.

**On `normalized_band` — phased rollout, not a day-one requirement:**
- MVP: leave this column `NULL` for everything. Ship on raw `role_title`/`level`
  text with fuzzy search; don't invent a taxonomy before you have real data.
- Phase 2: add a `company_level_mappings` table (below) and backfill this
  column via a batch job, not inline at write time.
- Use `normalized_band` only for cross-company comparison views. Company-specific
  pages should still show the raw `level` text — that's what candidates
  researching that company actually recognize.

### `company_level_mappings`
Populated manually/progressively per company — do not auto-guess mappings.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| company_id | uuid FK → companies | |
| raw_level_string | text | e.g. "L5", "Senior II" |
| normalized_band | text | one of the eight bands above |
| created_at | timestamptz | |

Constraint: `UNIQUE (company_id, raw_level_string)`.

### `interviewers`
Internal entity — never expose `internal_identifier` or any real name field publicly.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| company_id | uuid FK → companies | |
| internal_identifier_hash | text | for de-duplication only, never returned by public API |
| display_label | text | generated, e.g. "Interviewer A" — computed per-process, not stored globally identical |
| created_at | timestamptz | |

### `rounds`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| process_id | uuid FK → interview_processes | |
| sequence_number | smallint | order within the process |
| title | text | candidate-facing label, e.g. "Technical Screen" |
| description | text | nullable |
| round_type | text | `coding`, `system_design`, `behavioral`, `leadership`, `case_study`, `assessment`, `take_home`, `other` |
| interviewer_id | uuid FK → interviewers | nullable |
| scheduled_duration_minutes | smallint | nullable |
| type_metadata | jsonb | type-specific fields, see below |
| created_at | timestamptz | |

Index: `(process_id, sequence_number)`, `(round_type)`.

**`type_metadata` schema by `round_type`** (the round-type registry, GitHub
issue #248/Phase 24, `docs/DECISIONS.md` D47 — supersedes the earlier
free-form examples this section used to show for coding/case_study/
behavioral only). Defined in code at
`api/src/round-type-registry/round-type-field-schema.ts`; `controlled-*`
fields' selectable values live in the `round_type_field_options` table
below (admin-managed starting Phase 27), `text` fields are free-form
strings with no admin-managed vocabulary:

| `round_type` | Fields (`key`: `kind`) |
|---|---|
| `coding` | `problemAlgorithms`: controlled-multi, `problemDataStructures`: controlled-multi, `problemDescription`: text |
| `system_design` | `keyConcepts`: controlled-multi, `highLevelConcept`: text |
| `behavioral` | `frameworkUsed`: controlled-single, `focusAreas`: controlled-multi |
| `leadership` | `principlesAsked`: controlled-multi |
| `case_study` | `frameworksUsed`: controlled-multi, `industryContext`: text |
| `assessment` | `assessmentFormat`: controlled-single, `skillsAssessed`: controlled-multi |
| `take_home` | `projectType`: controlled-single, `technologiesUsed`: controlled-multi |
| `other` | `notes`: text — deliberately no controlled field, it's the catch-all round type by definition |

```json
// coding
{ "problemAlgorithms": ["DFS", "BFS"], "problemDataStructures": ["Graph"], "problemDescription": "Find shortest path in an unweighted graph" }

// leadership
{ "principlesAsked": ["Ownership", "Deliver Results"] }
```

Semantic validation (right keys for the round type, controlled values
currently active) happens in `RoundsService.create()`, not as DTO-level
validation — see D47.

### `round_type_field_options`
Admin-controlled selectable values for every `controlled-single`/
`controlled-multi` field above. One row per selectable value, e.g.
(`coding`, `problemAlgorithms`, `"DFS"`). Read-only (registry validation +
a public `GET /round-types/field-options`) as of Phase 24; admin CRUD over
this table is Phase 27.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| round_type | text | same `RoundType` enum as `rounds.round_type` |
| field_key | text | e.g. `problemAlgorithms` |
| value | text | e.g. `"DFS"` |
| sort_order | int | display order within (round_type, field_key) |
| is_active | boolean | retiring a value flips this off rather than deleting the row, so historical `type_metadata` referencing it stays valid |
| created_at | timestamptz | |
| updated_at | timestamptz | |

Unique: `(round_type, field_key, value)`. Index: `(round_type, field_key, is_active)`.

### `round_ratings`
Interviewer traits are deliberately limited to three (GitHub issue #247,
`docs/DECISIONS.md` D45) — `difficulty` is a separate axis (the round/
problem, not the interviewer).

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| round_id | uuid FK → rounds | |
| candidate_id | uuid FK → candidates | |
| difficulty | smallint | CHECK 1–5 — round/problem axis, not an interviewer trait |
| fluency | smallint | CHECK 1–5, interviewer trait — communication fluency |
| clarity | smallint | CHECK 1–5, interviewer trait — clarity of the problem statement |
| focus | smallint | CHECK 1–5, interviewer trait — focus/attentiveness during the interview |
| technical_depth | smallint | nullable, CHECK 1–5 |
| free_text | text | nullable |
| status | text | `pending`, `approved`, `rejected`, `flagged` — default `pending` |
| created_at | timestamptz | |

**Constraint:** `UNIQUE (round_id, candidate_id)` — one rating per candidate per round.

### `recruiters`
Same pattern as `interviewers` — internal identity, generated public label.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| company_id | uuid FK → companies | |
| internal_identifier_hash | text | |
| display_label | text | |
| created_at | timestamptz | |

### `recruiter_interactions`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| process_id | uuid FK → interview_processes | |
| recruiter_id | uuid FK → recruiters | |
| created_at | timestamptz | |

### `recruiter_ratings`
Fields redesigned per GitHub issue #249 (`docs/DECISIONS.md` D48) —
`response_time`/`timeliness` merged into `responsiveness`,
`communication_quality` dropped, `approachability` renamed +
reinterpreted as `reachability`, `guidelines_shared` and
`rejection_message_authenticity` are new.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| recruiter_interaction_id | uuid FK → recruiter_interactions | |
| candidate_id | uuid FK → candidates | |
| reachability | smallint | CHECK 1–5 — could you actually get hold of them when needed |
| responsiveness | smallint | CHECK 1–5 — merges the old response_time + timeliness |
| guidelines_shared | smallint | CHECK 1–5 — how much useful interview-prep guidance they shared |
| rejection_message_authenticity | smallint | nullable, CHECK 1–5 or NULL — only meaningful for a touchpoint about the process's rejection, self-reported by the candidate, no backend gating against `interview_processes.outcome` |
| free_text | text | nullable |
| status | text | `pending`, `approved`, `rejected`, `flagged` |
| created_at | timestamptz | |

**Constraint:** `UNIQUE (recruiter_interaction_id, candidate_id)`.

### `overall_reviews`
One per interview process — the summary review.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| process_id | uuid FK → interview_processes | unique — one overall review per process |
| candidate_id | uuid FK → candidates | |
| overall_experience | smallint | CHECK 1–5 |
| would_recommend | boolean | |
| review_text | text | nullable |
| status | text | `pending`, `approved`, `rejected`, `flagged` |
| created_at | timestamptz | |

### `moderators`
One row per staff identity (GitHub issue #485, Phase 36) — replaces the
single shared `ADMIN_USERNAME`/`ADMIN_PASSWORD_HASH` credential
(Phase 18). `role`/`is_active`/`created_by_id` (GitHub issue #586, Phase
42, D99) turn this from a single env-seeded identity into a real
`admin` > `moderator` > `staff` hierarchy: exactly one root `admin` stays
imperatively boot-seeded (`AdminAuthService.onModuleInit`), every other
row is created through admin tools by an existing `admin` (GitHub issue
#589). Deactivated, never deleted — same precedent `claimed_by` already
set by never being cleared.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| username | text | unique |
| password_hash | text | bcrypt |
| email | text | breach-notification recipient (GitHub issue #489, Phase 36) |
| role | text | `staff` \| `moderator` \| `admin` — defaults to `moderator` for pre-#586 rows |
| is_active | boolean | default `true`; deactivate rather than delete |
| created_by_id | uuid FK → moderators, nullable | null for the one root `admin`; always set for tool-created accounts |
| created_at | timestamptz | |

### `staff_audit_log`
Durable record of every admin action against a staff account — account
created, role changed, deactivated/reactivated, password reset (GitHub
issue #586, Phase 42, D99). Never best-effort, same precedent
`ai_auto_approval_audit` sets for system-attributed decisions below.
`actor_id` and `target_id` are equal for a self-service password change,
distinct for anything an `admin` does to another account.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| actor_id | uuid FK → moderators | who performed the action |
| target_id | uuid FK → moderators | account acted upon |
| action | text | `account_created` \| `role_changed` \| `deactivated` \| `reactivated` \| `password_reset` |
| detail | jsonb | nullable structured detail, e.g. `{"oldRole": "staff", "newRole": "moderator"}` |
| created_at | timestamptz | |

### `moderation_queue`
Generic moderation record referencing any of the rating/review tables above.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| entity_type | text | `round_rating`, `recruiter_rating`, `overall_review` |
| entity_id | uuid | |
| flag_reason | text | nullable — `spam_pattern`, `rate_limit`, `duplicate`, `manual_report` |
| reviewed_by | text | nullable — moderator id/system |
| reviewed_at | timestamptz | nullable |
| sla_deadline | timestamptz | `created_at` + a configurable number of hours (default 48, `MODERATION_SLA_HOURS`), set at enqueue/re-enqueue time (GitHub issue #486, Phase 36) |
| claimed_by | uuid FK → moderators, nullable | manual-claim assignment (GitHub issue #486/#487, Phase 36) |
| claimed_at | timestamptz | nullable |
| breach_notified_at | timestamptz | nullable — set once `SlaBreachDetectionService`'s hourly sweep has published a `moderation.queue.sla_breach.v1` event for this entry, so it's never re-notified on a later sweep tick (GitHub issue #488, Phase 36) |
| warning_notified_at | timestamptz | nullable — set once the sweep has published a `moderation.queue.sla_warning.v1` event for this entry (75% of the SLA window elapsed, still unclaimed), same never-cleared/never-re-notified precedent as `breach_notified_at` (GitHub issue #704, Phase 51) |
| created_at | timestamptz | |

---

## Aggregation layer (derived, not written directly)

Build these as materialized views (Postgres) initially, migrate to a
ClickHouse rollup table later if volume demands it. Recompute on a schedule
or via CDC trigger on rating writes.

### `company_round_type_aggregates`
Grain: `(company_id, round_type)`
- `avg_difficulty`, `avg_fluency`, `avg_clarity`, `avg_focus`, `sample_size`

### `company_recruiter_aggregates`
Grain: `(company_id)`
- `avg_reachability`, `avg_responsiveness`, `avg_guidelines_shared`,
  `sample_size`. `rejection_message_authenticity` is deliberately excluded
  (nullable/optional fields stay out of the shrinkage-scored aggregation
  layer — same precedent `round_ratings.technical_depth` already set).

### `company_overall_aggregates`
Grain: `(company_id, role_title_normalized?)` — decide during implementation
whether to slice by role/level; recommend starting company-wide, adding
slices once you have volume.
- `avg_overall_experience`, `pct_would_recommend`, `sample_size`

**Scoring rule enforced at the API layer, not the DB — use shrinkage, not a
hard cutoff.** A flat "hide below n=5" gate creates a misleading cliff: n=4
shows nothing, n=5 suddenly shows a raw average that's still barely
meaningful. Instead, pull small samples toward the platform-wide average and
let them converge to the true company average as `n` grows:

```
displayed_score = (n / (n + k)) * company_avg + (k / (n + k)) * global_avg
```

- `k` is a tunable confidence constant — start around 8–10.
- `global_avg` is the platform-wide average for that specific metric.
- Always return `sample_size` alongside every score so the frontend can show
  it — transparency instead of a hidden gate.
- One hard floor still applies: don't display any score below `n = 3`; below
  that, return `null` and let the frontend show "not enough reviews yet."
- At granular slices (e.g. per round-type), fall back to the company-wide
  aggregate when a slice is under the floor, with a note that it's showing
  overall data rather than that specific slice.

---

## Migration ordering

Write migrations in this order — later tables depend on earlier ones:

1. `companies`, `candidates`
2. `interview_processes`
3. `interviewers`, `recruiters`
4. `rounds`
5. `round_ratings`
6. `recruiter_interactions`
7. `recruiter_ratings`
8. `overall_reviews`
9. `moderation_queue`
10. `company_level_mappings` (nullable/unused until phase 2 — safe to include
    now or defer, doesn't block anything else)
11. Materialized views (aggregation layer)

**Decided:**
- Public aggregates use shrinkage scoring (see Aggregation layer section)
  rather than a hard sample-size gate. `k = 8` as a starting constant, tune
  after real data comes in.
- `normalized_band`/`company_level_mappings` are schema-ready from day one but
  populated progressively — MVP ships with them empty/unused.
- Migrations via Prisma.

## Open decisions to make before implementation

- Retention/deletion policy for `moderation_queue` entries and rejected content
  (GDPR erasure requests will need a defined path).
- Exact value of `k` in the shrinkage formula once you have enough real
  reviews to tune it against.
