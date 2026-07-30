# Phase 39, Issue #442 — Reconciliation Sweep for Stalled Moderation Triage (24h SLA)

*Part of Phase 39 — LLM Auto-Approval for High-Confidence Submissions. See
`docs/ROADMAP.md` Phase 39 and `docs/DECISIONS.md` D71/D72.*

## The gap this closed

`AiModerationService.computeAndStoreVerdict()` has been fully
best-effort since D66: a network error, a model refusal, an
unparseable response, an unset `ANTHROPIC_MODEL` — any of it gets
caught, logged, and swallowed, leaving the row's `moderationVerdict`
null and its `status` sitting at `pending`. That's the correct
behavior for a single request (never block the write a candidate is
actually waiting on), but it leaves a real operational gap once
auto-approval exists: a row that silently never got triaged looks
identical, from the database's point of view, to one a human simply
hasn't reviewed yet. Nothing was watching for "this LLM call ran once,
failed, and nobody ever retried it." D71 called this the
"lost/never-ran triage" gap and committed to closing it with a
scheduled sweep — this issue is that sweep.

## Key concept: retry once, and let the retry's own outcome decide whether to escalate

The sweep's logic reuses `computeAndStoreVerdict()` itself rather than
reimplementing triage — but that method returns `void` and never
throws (every failure is already caught inside it), so "did the retry
work" has to be observed from the row's own state afterward, not from
the call:

```ts
private async reconcileOne(entityType: TriageableEntityType, entityId: string): Promise<void> {
  await this.aiModerationService.computeAndStoreVerdict(entityType, entityId);

  const stillUnresolved = await this.hasNoVerdict(entityType, entityId);
  // null: the entity is gone (fast create-then-delete race) — nothing
  // left to escalate. false: the retry produced a verdict this time.
  if (stillUnresolved !== true) return;

  await this.escalate(entityType, entityId);
}
```

If the retry produces a verdict — even one that isn't auto-approval
eligible — that's success: a human moderator now has real signal to
act on, and the row drops out of the sweep's candidate set on the next
run since it filters on `moderationVerdict IS NULL`. Only a retry that
fails *again* gets escalated.

## Key concept: escalation reuses `ModerationService.flag()`, the same door a human's flag click uses

Consistent with #440's "never a new, parallel path" precedent, a
stalled row doesn't get some bespoke "needs attention" marker — it
gets flagged through the exact same entry point a moderator's own flag
button already calls, with a new reason dedicated to this specific
failure mode:

```prisma
enum ModerationFlagReason {
  spam_pattern
  rate_limit
  duplicate
  manual_report
  ai_triage_stalled
}
```

```ts
export const RECONCILIATION_SWEEP_SYSTEM_ACTOR = 'system:ai-reconciliation-sweep';

private async escalate(entityType: TriageableEntityType, entityId: string): Promise<void> {
  const queueEntry = await this.prisma.moderationQueueEntry.findFirst({
    where: { entityType, entityId, reviewedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!queueEntry) { /* log and return — nothing to flag */ }

  try {
    await this.moderationService.flag(queueEntry.id, {
      reviewedBy: RECONCILIATION_SWEEP_SYSTEM_ACTOR,
      flagReason: 'ai_triage_stalled',
    });
  } catch (err) { /* log and continue — never let one row crash the sweep */ }
}
```

Deliberately a *different* system actor than `#440`'s
`system:ai-auto-approval` — one only ever approves, this one only ever
flags, and the audit trail should tell the two apart at a glance.
`flag()` flips the entity's `status` to `flagged`, which also removes
it from the sweep's own `status: pending` filter — a stalled row gets
escalated exactly once, not re-flagged every subsequent hour.

## Key concept: a disabled feature is not the gap this sweep exists to close

The most consequential guard in this issue isn't in the retry logic at
all — it's the very first line of `sweep()`:

```ts
@Cron(CronExpression.EVERY_HOUR)
async sweep(): Promise<void> {
  // D66: this feature is disabled by default (no ANTHROPIC_API_KEY). A
  // pending row with no verdict is expected in that case — a human
  // reviews everything already, same as before this feature existed —
  // not the "lost/never-ran triage" gap this sweep exists to close.
  if (!isAiModerationEnabled()) return;
  // ...
```

Without this check, every environment that has never configured
`ANTHROPIC_API_KEY` at all — which is every environment today, since
the feature is disabled by default — would have every single pending
row flagged as "stalled" within 24 hours of its very first sweep. A
`pending` row with no verdict when the feature was never turned on
isn't a failure to recover from; it's D66's actual intended baseline
behavior (a human reviews everything). This is the same distinction
issue #441's kill switch draws, applied to a different call site.

## Key concept: no scheduling precedent existed, so this issue had to set one (D72)

The issue's own scope note assumed "the same pattern as this project's
other cron-style jobs" — but there was no such pattern. No
`@nestjs/schedule` usage anywhere in `api/src`, no Kubernetes CronJob
manifest under `infra/k8s`. The closest thing,
`api/scripts/prune-orphaned-*-search-docs.js`, is explicitly a manual,
run-by-hand script. This became D72: `@nestjs/schedule`'s `@Cron()`,
in-process inside the API service, hourly — not a dedicated CronJob
hitting a new endpoint or invoking a new script. It matches D66's own
"prove the policy simply first, in-process" sequencing (Phase 30-32
moves this async later, same as the rest of D66's logic is already
slated to) and the same "don't build infrastructure ahead of a
demonstrated need" instinct D71 already used to justify skipping a
transactional outbox. `ScheduleModule.forRoot()` now lives in
`AppModule`, and `ReconciliationSweepService` is its only consumer.

## Step-by-step: what actually got built and verified

1. Prisma migration adding the `ai_triage_stalled` value to
   `ModerationFlagReason`.
2. `ReconciliationSweepService` (new `@nestjs/schedule` `@Cron`,
   hourly): for each of `round_rating`/`recruiter_rating`/
   `overall_review`, finds `pending` rows with a null
   `moderationVerdict` older than 24h, retries triage, and escalates
   via `ModerationService.flag()` if the retry leaves the row
   unresolved again.
3. `ReconciliationSweepModule`, imported directly into `AppModule`
   (like `HealthModule`/`AnalyticsModule`) rather than folded into
   `AiModerationModule` — this is app-wide scheduled infrastructure,
   not something a single write-path feature module pulls in for
   itself.
4. `ScheduleModule.forRoot()` added to `AppModule`.
5. 8 new unit tests: disabled no-op, all three entity types actually
   swept, resolved-by-retry (no escalation), escalation on a repeat
   failure, the entity-gone race (no throw, no escalation), a missing
   queue entry (logged, not thrown), `flag()` itself throwing
   (swallowed, sweep still resolves), and multiple stale rows in one
   entity type all getting processed.
6. Full api suite (441 tests), `eslint`, and `tsc --noEmit` all clean;
   the new migration applied cleanly against a real local Postgres via
   `prisma migrate deploy`.

## What this enabled

Phase 39 is now feature-complete: a confidence-scored verdict (#439)
can auto-approve through the real moderation path with a durable audit
trail (#440), the whole thing has a single-env-var kill switch (#441),
and a triage that silently never finishes no longer sits invisible
forever — it gets one retry and, failing that, lands in front of a
human with a reason attached (#442) explaining exactly why it's there.
