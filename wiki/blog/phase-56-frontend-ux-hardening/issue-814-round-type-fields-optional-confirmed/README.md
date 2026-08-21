# Phase 56, Issue #814 — No Client-Side Required-Field Enforcement for Round-Type Fields

*Part of Phase 56 — Frontend & UX Hardening.
See `docs/ROADMAP.md` Phase 56.*

## The gap

The wizard's round-type-specific fields (the controlled-single/
controlled-multi/text fields keyed by `roundType`, e.g. `tech_screening`'s
`screeningFormat`/`topicsCovered`) render with no client-side
"required" enforcement — a candidate can leave every one of them blank
and still submit. Flagged by the audit as worth checking: is this a real
gap, or is it correctly matching backend behavior?

## The fix: confirm, don't guess — and document instead of building the wrong thing

Checking `RoundTypeFieldOptionsService.validateTypeMetadata()` (the
actual backend validation every submission passes through) settled it:
every round-type field is genuinely optional server-side, by design —
`typeMetadata` itself can be entirely absent, and any individual key
within it can be omitted too. Adding client-side required-field
enforcement would have been building the *wrong* fix — actively
mismatching, and wrongly blocking, submissions the backend was always
designed to accept:

```ts
// GitHub issue #814 (Phase 56) — confirmed against the backend
// (RoundTypeFieldOptionsService.validateTypeMetadata()): every field
// here is genuinely optional server-side, by design — `typeMetadata`
// itself can be entirely absent, and any individual key within it can be
// omitted too. Deliberately no `required` flag on this type — adding
// client-side required-field enforcement here would mismatch (and
// wrongly block) what the backend actually accepts.
```

The real fix for this issue was verification and documentation, not
code — confirming the frontend's current "no enforcement" behavior is
*correct*, not a gap, and recording that confirmation right where a
future contributor would otherwise re-discover the same question from
scratch.

## Verification

Cross-checked `validateTypeMetadata()`'s actual implementation directly
(not just its tests) to confirm no round type currently has a required
field — the comment's claim is a statement about real backend behavior,
verifiable by reading the one function that's the actual source of
truth for what's accepted.
