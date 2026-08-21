# Phase 53, Issue #793 — moderation_queue.entity_type List Missing 'company'

*Part of Phase 53 — Data Integrity, Consistency & Documentation
Reconciliation. See `docs/ROADMAP.md` Phase 53.*

## The gap

`docs/DATA_MODEL.md`'s `moderation_queue` table reference listed
`entity_type`'s possible values as `round_rating`, `recruiter_rating`,
`overall_review` — three, not the real four. `company` creation
requests have gone through this same queue since Phase 35 (issue #369),
but the schema doc was never updated to say so.

## The fix: add it, plus the one real behavioral asymmetry worth calling out

```diff
 | Column | Type | Notes |
 |---|---|---|
 | id | uuid PK | |
-| entity_type | text | `round_rating`, `recruiter_rating`, `overall_review` |
+| entity_type | text | `round_rating`, `recruiter_rating`, `overall_review`, `company` (added by GitHub issue #369, Phase 35 — company creation requests go through the same queue. It's the one type review-analyzer's AI auto-approval never triages — no `company-created` event schema exists on its consumer side — so a `company` entry is always resolved by a human moderator, never `AiAutoApprovalAudit`) |
```

The added note isn't just "here's a fourth value" — it records a real,
easy-to-miss asymmetry: every other `entity_type` gets an LLM second
opinion via `review-analyzer`'s AI-triage pipeline (D81), but
`company` requests don't — there's no `company.created.v1`-consuming
schema wired into `review-analyzer` at all, so a `company` entry in this
queue is *always* resolved by a human moderator, never eligible for
system-attributed auto-approval. Worth documenting right next to the
column that would otherwise look uniform across all four values when
it isn't.

## Verification

Documentation-only. Verified by cross-checking against
`ModerationService`'s actual `ModerationEntityType` union (which already
includes `'company'` in code, confirming the doc was the thing lagging,
not the schema) and against `review-analyzer`'s own event-schema
directory to confirm the "never AI-triaged" claim is accurate — no
`company`-shaped `*.created.v1` consumer exists there today.
