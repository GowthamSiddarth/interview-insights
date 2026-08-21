# Phase 57, Issue #821 — Kafka Consumers Silently Drop Messages Despite "Retried on Redelivery" Comments

*Part of Phase 57 — Code Quality & Performance Hardening.
See `docs/ROADMAP.md` Phase 57.*

## The gap

All three of this app's Kafka consumers (`verdict-consumer` in `api`,
`notification-consumer` and `analysis-consumer` in their respective
services) share the same design: never rethrow from message handling,
so one malformed or transiently-failing message can't crash-loop the
whole consumer or stall a partition on a poison pill. Correct,
deliberate, and already reasoned about elsewhere in this codebase.
Their catch blocks' own comments, though, claimed a failed message
"will be retried on redelivery" — never true. None of them rethrow, so
kafkajs's autocommit always advances past the message regardless,
whether the catch block's comment says so or not. The *design* wasn't
the bug here; the comment lying about what it actually does was — a
future reader debugging a dropped message would trust the comment,
conclude "it'll come back around," and stop looking, when nothing was
ever going to retry it.

## The fix: describe the real backstop, not a retry that doesn't exist

```ts
// verdict-consumer.service.ts
// GitHub issue #821 (Phase 57) — this comment used to say "will be
// retried on redelivery," which was never true given the "never
// throws" design above. A dropped verdict_computed event here just
// means this row's moderationVerdict stays null permanently — safe
// degradation, not lost data: the moderation page already renders
// null as "analysis pending" rather than conflating it with "no
// concerns found," and every row is human-reviewed regardless of
// whether an AI verdict ever arrives (CLAUDE.md hard constraint #2).
this.logger.error(
  `Failed to process "${event.eventType}" event for entity ${entityIdFor(event)} — not retried; moderationVerdict stays null (rendered as "analysis pending")`,
  err instanceof Error ? err.stack : err,
);
```

Each of the three consumers got the same treatment, but with the
*correct* backstop named for its own failure mode — not a generic
copy-paste fix:
`notification-consumer.service.ts` explains that a missed notification
has no automated backstop (the underlying write it would have notified
about is already durable, so nothing is *lost*, just unannounced), while
`analysis-consumer.service.ts` points at `ReconciliationSweepService`'s
real 24-hour sweep, which re-triages any row still sitting without a
verdict. The fix required actually understanding each consumer's real
failure-mode story, not just replacing one stock phrase with another
across three files.

## Verification

No behavior change — the never-rethrow design itself was correct all
along, so there's nothing new to test at the logic level. Verified by
re-reading each consumer's actual downstream consequence of a dropped
message (does `moderationVerdict` stay a harmless `null`? does the
missed-notification path genuinely have no automated backstop, or was
that claim itself worth double-checking too?) to confirm the new
comment's claim is accurate, not just differently worded.
