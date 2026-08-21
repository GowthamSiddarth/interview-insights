# Phase 53, Issue #791 — Stale "Zero Write Path" Claim in docs/ARCHITECTURE.md

*Part of Phase 53 — Data Integrity, Consistency & Documentation
Reconciliation. See `docs/ROADMAP.md` Phase 53.*

## The gap

`docs/ARCHITECTURE.md`'s "Known gaps" section still carried this
paragraph, unchanged since it was originally written:

> **`RecruiterInteraction`/`RecruiterRating`/`OverallReview` have zero
> write path.** The schema and migrations have existed since Phase 1,
> but no controller anywhere creates one, `ModerationService` explicitly
> throws `NotImplementedException` for either type, and the two
> corresponding materialized views... are permanently empty...

All three entity types have had full write paths since Phase 14 — real
controllers, real moderation coverage, real analytics aggregation.
Three separate audit passes in the same 2026-08-20 sweep (data
integrity, business logic, frontend) each independently re-derived this
same finding while reading the doc cold, which is itself informative:
a stale architecture doc doesn't just sit there unused — it actively
misleads whoever reads it next, repeatedly, until someone catches it.

## The fix: delete the stale paragraph

No replacement text needed — the paragraph described a gap that no
longer exists, so the fix is removing it outright, not updating it to
describe current reality:

```diff
 ## Known gaps (surfaced, not yet acted on)

-- **`RecruiterInteraction`/`RecruiterRating`/`OverallReview` have zero
-  write path.** The schema and migrations have existed since Phase 1,
-  but no controller anywhere creates one, `ModerationService` explicitly
-  throws `NotImplementedException` for either type, and the two
-  corresponding materialized views (`company_recruiter_aggregates`,
-  `company_overall_aggregates`) are permanently empty — not "below the
-  shrinkage floor," genuinely zero rows possible. The analytics
-  dashboard's "recruiter experience" and "overall experience" sections
-  will show "Not enough reviews yet" indefinitely until this is built.
-  This is a real, sizeable feature gap — building it out is a scoped
-  decision for a future planning pass, not something implied by this doc.
 - **Fraud/spam volume growth** — the moderation service will need real ML
   scoring (not just rules) once volume grows; revisit as a dedicated
   workstream, don't bolt it onto the write path later.
```

## Verification

Documentation-only. Verified by cross-checking the actual current state
of `RecruiterRatingsController`/`OverallReviewsController` (both real,
both wired into `ModerationService`) and confirming the two materialized
views this paragraph claimed were "permanently empty" do in fact
populate from real approved rows — the exact thing #787's refresh fix,
landed in the same phase, keeps current going forward.
