# Phase 39, Issue #439 — Confidence Score & Single-Cutoff Auto-Approve Routing

*Part of Phase 39 — LLM Auto-Approval for High-Confidence Submissions. See
`docs/ROADMAP.md` Phase 39 and `docs/DECISIONS.md` D71.*

## The gap this closed

Phase 19 (D66) gave every round rating, recruiter rating, and overall
review an LLM second opinion via `AiModerationService.computeAndStoreVerdict()`
— but that verdict was purely advisory. `concerning`/`reasons`/`summary`
got written to a `moderationVerdict` JSONB column and nothing else ever
happened; a human still reviewed every single row, clean or not. That
was a deliberate, non-negotiable property of D66 (CLAUDE.md hard
constraint #2), not an oversight — but as review volume grew, it meant
the LLM's opinion on an obviously-clean, boring five-out-of-five rating
carried exactly as much moderator workload as a genuinely ambiguous one.

Phase 39 exists to change that for the high-confidence-clean band only.
Its kickoff brainstorm (issue #437, resolved into D71) settled the
shape before any code was written: a single hard confidence cutoff, not
the three-tier clean/ambiguous/concerning design originally sketched —
the "ambiguous" band would have needed its own Phase 36 ticket-queue
integration for a benefit that wasn't clearly there once the shape got
scrutinized. Below the cutoff, everything behaves exactly as it does
under D66 today. This issue is step one: give the model a confidence
score, and compute (but don't yet act on) whether a verdict clears the
bar.

## Key concept: confidence is a self-reported number added to the same JSON contract

D66's system prompt already asked the model for a fixed JSON shape.
Adding a `confidence` field meant extending that contract, not
inventing a new call:

```
Respond with a single JSON object and nothing else, matching exactly
this shape:
{"concerning": boolean, "reasons": string[], "summary": string, "confidence": number}

"confidence" is a 0-1 score for how confident you are in this verdict
as a whole (1 = certain, 0 = a coin flip) — a low-confidence verdict
should read as a weaker signal to the moderator regardless of which way
"concerning" came out.
```

The model is self-reporting its own uncertainty, not being graded
against ground truth — this is a heuristic the LLM produces alongside
its verdict, the same way `reasons`/`summary` already are. It's stored
verbatim in `moderationVerdict` for every entity, whether or not it
ends up mattering for routing.

## Key concept: no numeric default, fails closed instead of throwing

`AI_MODERATION_AUTO_APPROVE_THRESHOLD` is a new env var, but it
deliberately breaks from `ANTHROPIC_MODEL`'s existing pattern of "must
be set, or the app throws":

```ts
export function getAutoApprovalConfidenceThreshold(): number | null {
  const raw = process.env.AI_MODERATION_AUTO_APPROVE_THRESHOLD;
  if (raw === undefined) return null;

  const threshold = Number(raw);
  if (Number.isNaN(threshold) || threshold < 0 || threshold > 1) {
    throw new Error(
      `AI_MODERATION_AUTO_APPROVE_THRESHOLD must be a number between 0 and 1, got "${raw}".`,
    );
  }
  return threshold;
}
```

No starting value is guessed in a design doc — D71 is explicit that
this gets tuned empirically once real verdict/confidence data exists in
an environment. So leaving it unset doesn't throw the way an unset
`ANTHROPIC_MODEL` does; it just means nothing is ever eligible, which
is exactly today's D66 behavior. Only a genuinely *invalid* set value
(unparseable, or outside `[0, 1]`) is treated as a misconfiguration
worth failing loudly for — same "swallowed as a logged failure, never
blocks the write" discipline D66 already established for every other
failure mode here.

## Key concept: the routing decision is computed once, stored, not re-derived later

```ts
const autoApprovalEligible = this.isEligibleForAutoApproval(record.concerning, record.confidence);
const verdict: Prisma.InputJsonObject = {
  ...(parsed as Prisma.InputJsonObject),
  model,
  analyzedAt: new Date().toISOString(),
  autoApprovalEligible,
};
```

```ts
private isEligibleForAutoApproval(concerning: unknown, confidence: unknown): boolean {
  if (concerning !== false) return false;
  if (typeof confidence !== 'number' || Number.isNaN(confidence)) return false;

  const threshold = getAutoApprovalConfidenceThreshold();
  if (threshold === null) return false;

  return confidence >= threshold;
}
```

`autoApprovalEligible` gets persisted alongside the rest of the verdict
so the next issue in this phase (#440, the actual system-attributed
approval) can just read a boolean rather than re-deriving eligibility
from raw fields. Three conditions all have to hold: `concerning` must
be exactly `false` (not just falsy — a model response that omits the
field entirely stays ineligible), `confidence` has to be a real,
non-`NaN` number, and the threshold has to be both configured and met.
Any one of those failing degrades silently to "not eligible," never a
thrown error — a clean but low-confidence verdict, or a concerning one
regardless of confidence, both just stay `pending` for a human exactly
as before.

## Step-by-step: what actually got built and verified

1. Extended the LLM system prompt to request `confidence` alongside the
   existing three fields.
2. Added `AI_MODERATION_AUTO_APPROVE_THRESHOLD` (`ai-moderation.env.ts`),
   fail-closed on unset, throwing only on a genuinely invalid value.
3. Added `isEligibleForAutoApproval()` and threaded its result into the
   stored `moderationVerdict` as `autoApprovalEligible`, computed
   identically across all three D66-covered entity types — their triage
   logic was already shared, so no partial rollout was needed.
4. 16 new/updated unit tests covering: eligible/ineligible at the
   threshold boundary, `concerning: true` always ineligible regardless
   of confidence, an unset threshold always ineligible, an invalid
   threshold (out of range or unparseable) swallowed as a logged
   failure with no verdict stored at all, and a model response that
   omits `confidence` entirely treated as ineligible.

## What this enabled

`autoApprovalEligible: true` is now sitting in `moderationVerdict` for
every clean, high-confidence verdict — but nothing acts on it yet.
Issue #440 is the next post in this phase: the actual system-attributed
`ModerationService.approve()` call and its durable audit trail.
