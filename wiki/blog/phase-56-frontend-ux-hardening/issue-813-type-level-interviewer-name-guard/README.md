# Phase 56, Issue #813 — No Type-Level Guard Against a Future Interviewer-Name Leak

*Part of Phase 56 — Frontend & UX Hardening.
See `docs/ROADMAP.md` Phase 56, CLAUDE.md hard constraint #1.*

## The gap

`ModerationQueueEntity`'s frontend type already only ever carries
`recruiterLabel` (a generated label) — the frontend is compliant with
CLAUDE.md hard constraint #1 (never expose a real interviewer/recruiter
name) purely because it happens to only ever render that field, never a
raw name. Nothing in the type itself, or anywhere near it, said so.
A future backend change that started returning a raw interviewer name
into this same shape would sail through TypeScript's structural typing
with zero warning — the compiler has no way to know "this field must
never be a real name" unless a human reading the code happens to
already know the constraint and remembers to check for it every time.

## The fix: a guard comment, load-bearing precisely because TypeScript can't enforce this

```ts
// GitHub issue #813 (Phase 56) — GUARD, don't skip reading this before
// adding a field here: CLAUDE.md hard constraint #1 forbids exposing a
// real interviewer/recruiter identity anywhere a candidate or moderator
// can read it publicly. Nothing today enforces that at the type level —
// the frontend is compliant only because it happens to only ever render
// a generated label (recruiterLabel below), never a raw name. If a
// future backend change starts returning a raw interviewer/recruiter
// name into this shape, nothing here will catch it. Any new field that
// could carry interviewer/recruiter identity must be named and commented
// [...]
export interface ModerationQueueEntity {
  // ...
  recruiterLabel?: string;
}
```

Not a runtime check, not a lint rule, not a branded type — just a
comment, placed exactly where a future edit to this interface would
have to be made, written so it's read *before* the mistake happens
rather than caught *after*. This is a real, honest limitation worth
naming directly: TypeScript's structural typing genuinely can't
distinguish "a label string" from "a name string" — both are just
`string`. A determined future change could still add a raw-name field
here and nothing would fail — the guard's whole value is being visible
at exactly the edit site, not technical enforcement.

## Verification

No test possible for a code comment's effectiveness — this is a
documentation/process control, not a runtime one. The closest thing to
verification is confirming the comment sits directly above the one field
(`recruiterLabel`) a future edit is most likely to be made adjacent to,
maximizing the odds it's actually read.
