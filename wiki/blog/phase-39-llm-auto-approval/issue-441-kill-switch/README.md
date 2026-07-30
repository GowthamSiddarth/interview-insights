# Phase 39, Issue #441 — Config-Driven Kill Switch for LLM Auto-Approval

*Part of Phase 39 — LLM Auto-Approval for High-Confidence Submissions. See
`docs/ROADMAP.md` Phase 39 and `docs/DECISIONS.md` D71.*

## The gap this closed

By the end of issue #440, a clean, high-confidence verdict could
publish real user-facing content with no human in the loop. D71 called
the kill switch a load-bearing part of that decision, not follow-up
hardening — the whole feature needed one obvious, no-deploy-required
way to force every verdict back to D66's original advisory-only
behavior, in case the confidence threshold turns out to be miscalibrated
or the model starts misbehaving in production. This issue builds
exactly that, and only that: a single global toggle, not a partial one.

## Key concept: the kill switch and the confidence threshold are separate knobs, on purpose

The kickoff brainstorm (issue #437) had already settled *that* this
would be one global env var rather than per-entity-type switches — the
simplest option, revisited only if production ever surfaces a concrete
reason one entity type needs independent control. The remaining design
question was where the switch should live relative to
`AI_MODERATION_AUTO_APPROVE_THRESHOLD` (issue #439). Folding "enabled"
into the threshold itself (e.g. a magic sentinel value) was rejected:
an operator flipping the feature off shouldn't lose whatever threshold
they've already tuned, and flipping it back on shouldn't mean
re-entering a number. Two independent env vars, two independent
functions:

```ts
export function isAutoApprovalEnabled(): boolean {
  return process.env.AI_AUTO_APPROVAL_ENABLED === 'true';
}
```

The `=== 'true'` check isn't a new pattern invented for this — it's the
same boolean-env convention `COOKIE_SECURE` already uses
(`session-cookie-options.util.ts`). Unset, empty, or anything other
than the literal string `"true"` means disabled — no
special-casing `"1"`, `"yes"`, or a case-insensitive match, so there's
exactly one way to turn it on and no ambiguity about what an
unrecognized value does.

## Key concept: one gate, in the same place the routing decision already lives

The obvious place to check the switch is wherever `autoApprovalEligible`
gets decided — not a second call site, not a guard wrapped around
`autoApprove()` after the fact:

```ts
private isEligibleForAutoApproval(concerning: unknown, confidence: unknown): boolean {
  if (!isAutoApprovalEnabled()) return false;
  if (concerning !== false) return false;
  if (typeof confidence !== 'number' || Number.isNaN(confidence)) return false;

  const threshold = getAutoApprovalConfidenceThreshold();
  if (threshold === null) return false;

  return confidence >= threshold;
}
```

Checking it first, inside the same function issue #439 already built,
means there's exactly one place in the codebase that decides whether
auto-approval can ever fire — flipping the env var off is provably a
complete kill, not "disabled in most code paths." It also fails closed
the same way every other condition in this function already does: no
numeric default, no exception, just `false`.

## Key concept: existing tests had to change to keep meaning what they claimed

This issue's least glamorous but most important detail: issue #439's
tests already asserted `autoApprovalEligible: true` for a clean,
high-confidence verdict — but with a hard-disabled-by-default kill
switch now sitting in front of that logic, those assertions would still
pass for the *wrong reason* (short-circuited by the switch, never
actually reaching the confidence/threshold check they claimed to
exercise) unless they explicitly opted in:

```ts
describe('auto-approval eligibility routing (GitHub issue #439, D71)', () => {
  beforeEach(() => {
    // Isolates these tests to the confidence/threshold logic they name —
    // the kill switch is covered in its own describe block below.
    process.env.AI_AUTO_APPROVAL_ENABLED = 'true';
  });
  // ...
```

A dedicated `describe('auto-approval kill switch ...')` block then
covers the switch itself in isolation: unset stays disabled even when
clean/high-confidence/above-threshold, any value other than the exact
string `"true"` (including `"TRUE"`) stays disabled, and `"true"` with
every other condition met is actually eligible end-to-end through
`ModerationService.approveWithAudit()`.

## Step-by-step: what actually got built and verified

1. `isAutoApprovalEnabled()` added to `ai-moderation.env.ts`, same
   `=== 'true'` convention as `COOKIE_SECURE`.
2. Wired in as the first check inside `isEligibleForAutoApproval()`.
3. `AI_AUTO_APPROVAL_ENABLED="false"` documented in `.env.example`,
   defaulting to disabled everywhere until an operator deliberately
   opts in.
4. Existing eligibility/audit tests updated to explicitly enable the
   switch so they isolate what they actually claim to test; three new
   tests added for the switch itself.
5. 23/23 tests passing, `eslint`/`tsc --noEmit` clean.

## What this enabled

Operating this feature in production is now genuinely reversible: one
env var, no deploy, and every verdict falls back to exactly D66's
original advisory-only behavior. The last issue in this phase (#442)
closes the remaining operational gap — a triage that silently never
completes at all.
