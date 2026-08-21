# Phase 53, Issue #794 — Round-Type Registry Table Missing tech_screening

*Part of Phase 53 — Data Integrity, Consistency & Documentation
Reconciliation. See `docs/ROADMAP.md` Phase 53.*

## The gap

`docs/DATA_MODEL.md`'s round-type registry reference table (the doc
listing each `RoundType` enum value alongside its `type_metadata`
fields) was missing a row for `tech_screening` — a real, shipped round
type with its own real fields
(`round-type-field-schema.ts`), just never added to the doc's table
when the type itself was introduced.

## The fix: add the missing row

```diff
 | `case_study` | `frameworksUsed`: controlled-multi, `industryContext`: text |
 | `assessment` | `assessmentFormat`: controlled-single, `skillsAssessed`: controlled-multi |
 | `take_home` | `projectType`: controlled-single, `technologiesUsed`: controlled-multi |
+| `tech_screening` | `screeningFormat`: controlled-single, `topicsCovered`: controlled-multi |
 | `other` | `notes`: text — deliberately no controlled field, it's the catch-all round type by definition |
```

Matches the live source of truth exactly — `round-type-field-schema.ts`'s
own `tech_screening` entry:

```ts
tech_screening: [
  { key: 'screeningFormat', kind: 'controlled-single' },
  { key: 'topicsCovered', kind: 'controlled-multi' },
],
```

The smallest of the four documentation-reconciliation issues in this
phase, and a useful reminder of why they were bundled together rather
than each getting its own epic: none of these four gaps was individually
worth a full planning pass, but three independent audit passes each
tripping over stale docs in the same sweep was worth fixing as a batch.

## Verification

Documentation-only. Verified by a direct field-for-field comparison
against `round-type-field-schema.ts`'s actual `tech_screening` entry —
the doc table exists specifically to mirror that file, so "does it match
exactly" is the whole correctness bar here.
