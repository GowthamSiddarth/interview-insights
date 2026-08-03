# Phase 32, Issue #340 — Porting LLM-Assisted Triage Into `review-analyzer` as an Async Enrichment

*Part of Phase 32 — Review Analyzer Service. See `docs/ROADMAP.md` Phase 32
and `docs/DECISIONS.md` D81 (including its same-day addendum).*

## The gap this closed

Issue #339 gave `review-analyzer` a working skeleton that only logged
receipt of a `moderation.*.created.v1` event. This issue is where Phase
19's `AiModerationService` (D66) and Phase 39's auto-approval/reconciliation
logic (D71/D72) — both built to run in-process inside `api` — actually
moved. `review-analyzer` now computes the same LLM verdict, publishes it
as a new `moderation.<type>.verdict_computed.v1` event per issue #338's
decision, and `api` gains its first-ever event *consumer*
(`VerdictConsumerService`) to apply it. The old in-process call sites
had to come out of `api` entirely, not just get bypassed — leaving them
in place would let both paths independently call `approveWithAudit()` on
the same submission.

## Key concept: `AnalysisService` is the old service, ported almost verbatim

`AnalysisService.requestVerdict()`/`buildContent()` are `api`'s old
`AiModerationService` methods, moved with two changes: content is read
from `review-analyzer`'s own read-only Prisma tables (D75) instead of
`api`'s, and the result is never written to a DB or acted on here at
all — it's returned to the caller, which is either
`AnalysisConsumerService` (a fresh `*.created` event) or
`ReconciliationSweepService` (a re-triage). Both callers only route the
verdict onward as an event through the same
`buildVerdictComputedEvent()` helper, so the two paths can't drift
apart:

```ts
export function buildVerdictComputedEvent(
  entityType: TriageableEntityType,
  entityId: string,
  result: VerdictResult | null,
): { topic: string; event: Record<string, unknown> } { /* ... */ }
```

`computeVerdict()` returns `null` for exactly the same cases the old
in-process path silently no-opped on: the feature disabled (no
`ANTHROPIC_API_KEY`), the entity already gone (a fast create-then-delete
race), or the LLM call/parse failing — every failure caught and logged,
never thrown. `review-analyzer` publishes nothing in that case, same
externally-visible behavior as before: `moderationVerdict` simply stays
untouched.

## Key concept (D81 addendum): removing the old code path is the correctness fix, not cleanup

Porting the logic to a new service and leaving `AiModerationService`
running in `api` alongside it would have looked like a safe, incremental
migration — but it isn't. Both paths would each independently call
`approveWithAudit()` for the same high-confidence submission: once
synchronously in `api`'s old write path, once async via
`review-analyzer`'s new event. This is a real double-auto-approval risk,
not a style preference, so `AiModerationService` and
`anthropic-client.provider.ts` were deleted from `api` outright, along
with the four env-driven feature flags
(`isAiModerationEnabled`/`getAnthropicModel`/
`getAutoApprovalConfidenceThreshold`/`isAutoApprovalEnabled`) and their
backing env vars — `api` no longer reads `ANTHROPIC_API_KEY`/
`ANTHROPIC_MODEL`/`AI_MODERATION_AUTO_APPROVE_THRESHOLD`/
`AI_AUTO_APPROVAL_ENABLED` at all. `review-analyzer` is now the only
place in this project the LLM is ever called from.

## Key concept: `api`'s first-ever event consumer closes the loop, without giving `review-analyzer` write access

`VerdictConsumerService` mirrors the shape of every consumer this project
has built so far (same connect/reconnect handling as
`notification-service`'s and `review-analyzer`'s own consumers), but it's
the first one living inside `api`. On a normal verdict it writes
`moderationVerdict`, then — when `autoApprovalEligible` is true — calls
the exact same `approveWithAudit()` D71 already built, attributed to a
fixed system actor:

```ts
await this.moderationService.approveWithAudit(
  queueEntry.id,
  { reviewedBy: AUTO_APPROVAL_SYSTEM_ACTOR },
  { entityType, entityId, promptContent, responseText, verdict, confidence, model },
);
```

This is what keeps issue #338's decision literally true: `review-analyzer`
never calls `approve()` or `flag()`, never touches `moderation_queue` at
all — it only computes and publishes. The decision to act on a verdict,
and CLAUDE.md hard constraint #2 ("every rating/review write goes
through moderation"), both still happen entirely inside `api`.

## Key concept (D81 addendum): the reconciliation sweep's escalation can't fully port, so it publishes an event instead

Phase 39's `ReconciliationSweepService` (D72) re-triages any `pending`
row with no verdict past a 24h staleness window, escalating a
still-unresolved one to a human-visible flag. The re-triage part ports
cleanly — `review-analyzer` now owns the only Prisma client that can
call the LLM anyway. The escalation part doesn't: calling
`ModerationService.flag()` directly is a `moderation_queue` write, which
per D81 only `api` may do. The fix extends `verdict_computed`'s payload
with an optional `stalled: true` marker (verdict/confidence/prompt/
response all `null` on that variant) instead of calling `flag()` from
`review-analyzer` directly:

```ts
const { topic, event } = buildVerdictComputedEvent(entityType, entityId, null);
await this.verdictPublisher.publish(topic, event, entityId);
```

`api`'s `VerdictConsumerService` checks for that marker first and routes
it to `flag()` itself, with the same `ai_triage_stalled` reason and the
same `RECONCILIATION_SWEEP_SYSTEM_ACTOR` the old in-process sweep used:

```ts
if (event.stalled === true) {
  await this.escalateStalled(entityType, entityId);
  return;
}
```

## Key concept (D81 addendum): an edited rating loses its free same-request re-triage

A smaller gap surfaced only once implementation actually removed the old
call sites: `update()` used to call `computeAndStoreVerdict()` directly,
right after `reenqueue()`, giving an edited rating an immediate re-triage
in the same request. There's no `*.created`-shaped event published on
edit (`reenqueue()` never published one, even before this issue), so an
edit now resets `moderationVerdict` to `Prisma.DbNull` in the same
transaction as `reenqueue()` — which is what makes the edited row visible
to the reconciliation sweep's own null-verdict query. The one real
behavior change: re-triage of an edit is no longer immediate; it now
lands within the sweep's 24h window, the same latency D72's original
"lost/never-ran triage" gap already tolerated elsewhere. The upside is
strictly better than before: an edited row can no longer keep showing
(or get auto-approved against) a stale pre-edit verdict while waiting.

## Step-by-step: what actually got built and verified

1. `AnalysisService`/`ai-moderation.env.ts`/`anthropic-client.provider.ts`:
   ported from `api`'s old `AiModerationService` verbatim except for the
   two changes above (own Prisma tables, never writes/acts — only returns
   a `VerdictResult`).
2. `AnalysisConsumerService.processEvent()` given its real body: compute
   the verdict, then publish via `buildVerdictComputedEvent()` if one
   came back.
3. `ReconciliationSweepService` ported with the `stalled: true`
   escalation-by-event change described above; still runs hourly via
   `@Cron(CronExpression.EVERY_HOUR)` against the same 24h staleness
   window.
4. `api`'s `VerdictConsumerService` (new): consumes all three
   `moderation.*.verdict_computed.v1` topics, writes `moderationVerdict`,
   routes a high-confidence verdict to `approveWithAudit()` and a
   `stalled: true` event to `flag()`.
5. Deleted `api`'s `AiModerationService`, `anthropic-client.provider.ts`,
   and their call sites from the rating/review write paths and
   `ReconciliationSweepService`'s own old in-process version, plus the
   four now-unused env-flag functions and backing env vars.
6. `update()`'s edit path: reset `moderationVerdict` to `Prisma.DbNull`
   alongside the existing `reenqueue()` call.
7. `web/src/app/moderation/page.tsx`: `AiModerationVerdict` now renders a
   distinct "analysis pending" state for a `null` verdict instead of
   rendering nothing, so a moderator can tell "not yet triaged" apart
   from "triaged, no concerns."
8. Anthropic secret/IAM access (LocalStack seeding, verify scripts,
   docker-compose, k8s ConfigMap/Secret wiring, CI) moved from `api` to
   `review-analyzer` wholesale, matching the "only place the LLM is ever
   called from" change above.
9. Tests: `services/review-analyzer` (40 unit tests), `api` (444 unit
   tests), `web` (159 unit tests including the new pending-state
   assertions) all passing locally; e2e suites for both services written
   against a real Postgres/Redpanda but left for CI to run.

## What this enabled

Phase 32's actual goal: the same LLM-assisted triage and auto-approval
behavior Phase 19/39 already shipped, now running as a genuinely separate
process that can be deployed, scaled, and rolled back independently of
`api` — with `api` left holding the one property that matters most,
sole write access to its own moderation decisions. Only issue #341 (this
post) was left to close Phase 32.
