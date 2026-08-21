# Phase 53, Issue #792 — GDPR Erasure Listed as an Open Decision Though It's Implemented

*Part of Phase 53 — Data Integrity, Consistency & Documentation
Reconciliation. See `docs/ROADMAP.md` Phase 53.*

## The gap

`docs/DATA_MODEL.md`'s "Open decisions to make before implementation"
section still listed:

> - Retention/deletion policy for `moderation_queue` entries and
>   rejected content (GDPR erasure requests will need a defined path).

`DELETE /me` (`MeService.eraseMe()`, GitHub issue #151) has been fully
implemented for a long time by this point — real per-candidate
deletion, not anonymization, covering every table a candidate owns.
This line described a problem that had already been solved, sitting
unedited in a section explicitly reserved for problems that *haven't*
been.

## The fix: split what's actually still open from what's done

```diff
 ## Open decisions to make before implementation

-- Retention/deletion policy for `moderation_queue` entries and rejected content
-  (GDPR erasure requests will need a defined path).
+- Retention/deletion policy for `moderation_queue` entries and rejected
+  content that a candidate never explicitly erases (how long does
+  rejected/flagged content stick around on its own?). GDPR erasure
+  itself is no longer open — `DELETE /me` (GitHub issue #151,
+  `MeService.eraseMe()`) is fully implemented, per-candidate, real
+  deletion (not anonymization); see GitHub issue #792 (Phase 53).
```

The original line actually bundled two distinct questions: "does a
candidate have a way to erase their own data" (answered — yes, fully
implemented) and "what happens to content nobody ever explicitly asked
to erase" (genuinely still open — there's no automatic retention/expiry
policy for old rejected content sitting in `moderation_queue`
indefinitely). Splitting them means the doc now accurately flags only
the real remaining gap, instead of one merged bullet implying both are
unsolved.

## Verification

Documentation-only. Verified by re-reading `MeService.eraseMe()`'s
actual deletion order (covers every table with a `candidateId`, per
#788's fix in this same phase) against the claim being retracted, and
by confirming the narrower remaining question (unbounded retention of
content nobody erased) doesn't already have an answer hiding elsewhere
in the docs that would make it stale too.
