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
| slug | text | unique, for URLs |
| industry | text | nullable |
| size_bucket | text | enum-like: `startup`, `mid`, `large`, `enterprise` |
| logo_url | text | nullable |
| created_at | timestamptz | default now() |

### `candidates`
Represents a reviewer. Kept minimal and pseudonymous.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| email_hash | text | unique — hashed, never store raw email |
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

**`type_metadata` examples by `round_type`:**
```json
// coding
{ "language_used": "Python", "platform": "CoderPad", "problem_topic": "graphs" }

// case_study
{ "framework_provided": true, "industry_context": "fintech" }

// behavioral
{ "framework_used": "STAR", "focus_areas": ["conflict resolution", "ownership"] }
```

### `round_ratings`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| round_id | uuid FK → rounds | |
| candidate_id | uuid FK → candidates | |
| difficulty | smallint | CHECK 1–5 |
| fairness | smallint | CHECK 1–5 |
| communication_fluency | smallint | CHECK 1–5, interviewer trait |
| attentiveness | smallint | CHECK 1–5, interviewer trait |
| bias_signal | smallint | CHECK 1–5 — higher = less bias perceived; document polarity clearly in code |
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
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| recruiter_interaction_id | uuid FK → recruiter_interactions | |
| candidate_id | uuid FK → candidates | |
| approachability | smallint | CHECK 1–5 |
| response_time | smallint | CHECK 1–5 |
| timeliness | smallint | CHECK 1–5 |
| communication_quality | smallint | CHECK 1–5 |
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
| created_at | timestamptz | |

---

## Aggregation layer (derived, not written directly)

Build these as materialized views (Postgres) initially, migrate to a
ClickHouse rollup table later if volume demands it. Recompute on a schedule
or via CDC trigger on rating writes.

### `company_round_type_aggregates`
Grain: `(company_id, round_type)`
- `avg_difficulty`, `avg_fairness`, `avg_communication_fluency`,
  `avg_attentiveness`, `avg_bias_signal`, `sample_size`

### `company_recruiter_aggregates`
Grain: `(company_id)`
- `avg_approachability`, `avg_response_time`, `avg_timeliness`,
  `avg_communication_quality`, `sample_size`

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
