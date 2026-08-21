# Phase 52, Issue #782 — verdict-consumer Doesn't Schema-Validate Kafka Payloads

*Part of Phase 52 — Security & Access-Control Hardening.
See `docs/ROADMAP.md` Phase 52.*

## The gap

`VerdictConsumerService` — the `api`-side consumer of
`moderation.*.verdict_computed.v1` events `review-analyzer` publishes
(D81) — did `JSON.parse(message.value.toString())` and trusted the
result was shaped correctly, with nothing checking that before the
parsed object flowed into a Prisma update
(`moderationVerdict`) or, when `autoApprovalEligible` is true, into an
actual system-attributed moderation approval.

Today this is genuinely low-risk — Redpanda is internal-only, and
`review-analyzer` is the only publisher to these topics. But "internal
only, one trusted publisher" describes a lot of software right up until
it doesn't: a bug in `review-analyzer` that produces a slightly
malformed event, a future second producer, or a compromised broker would
all hit this same unchecked path with nothing to catch them before a
consequential write.

## The fix: class-validator DTOs at the consumer boundary

One base DTO shared by the three real entity types, plus three thin
subclasses discriminating on `eventType`:

```ts
export abstract class BaseVerdictComputedEventDto {
  @Equals(1)
  eventVersion!: 1;

  @IsISO8601()
  occurredAt!: string;

  @ValidateIf((_o, value) => value !== null)
  @IsObject()
  verdict!: Record<string, unknown> | null;

  @IsBoolean()
  autoApprovalEligible!: boolean;

  @ValidateIf((_o, value) => value !== null)
  @IsNumber()
  confidence!: number | null;

  // ... model, promptContent, responseText — same T | null shape

  @IsOptional()
  @Equals(true)
  stalled?: true;
}

export class RoundRatingVerdictComputedEventDto extends BaseVerdictComputedEventDto {
  @Equals('moderation.round_rating.verdict_computed')
  eventType!: 'moderation.round_rating.verdict_computed';

  @IsUUID()
  roundRatingId!: string;
}
// RecruiterRatingVerdictComputedEventDto, OverallReviewVerdictComputedEventDto — same shape
```

The `@ValidateIf((_o, value) => value !== null)` pattern is doing real
work here: `verdict`/`confidence`/`model`/`promptContent`/`responseText`
are all `T | null` on the wire (never optional) — a genuine reconciliation-
sweep-escalation payload legitimately carries `null` for all of them
alongside `stalled: true`. `ValidateIf` lets `null` through unvalidated
while still requiring the *field itself* be present — a genuinely
missing field still fails, same as a wrong-typed one would.

Parsing and validating are one function, exported (not a private class
method) so it's unit-testable in isolation:

```ts
export function parseVerdictComputedEvent(raw: string): VerdictComputedEvent {
  const parsed = JSON.parse(raw) as { eventType?: unknown };
  const eventType = parsed.eventType;
  if (typeof eventType !== 'string' || !TOPICS_BY_EVENT_TYPE.has(eventType)) {
    throw new Error(`Unrecognized eventType "${String(eventType)}"`);
  }

  const dtoClass = DTO_BY_EVENT_TYPE[eventType] as new () => BaseVerdictComputedEventDto;
  const instance = plainToInstance(dtoClass, parsed);
  const errors = validateSync(instance);
  if (errors.length > 0) {
    throw new Error(`Event failed schema validation: ${errors.map((e) => e.toString()).join('; ')}`);
  }
  return instance as unknown as VerdictComputedEvent;
}
```

A malformed or unrecognized event now throws before it ever reaches the
Prisma layer — and because this consumer already follows this app's
established "never crash-loop the whole consumer on one bad message"
convention, that throw is caught by the surrounding `handleMessage()`,
logged, and skipped (autocommit still advances), not left to take down
the process.

## Verification

Unit tests directly against `parseVerdictComputedEvent()`: a
well-formed payload for each of the three entity types round-trips
correctly, a missing/wrong-typed field on each throws, an unrecognized
`eventType` throws, and — the case `ValidateIf` exists for — a
`stalled: true` payload with every content field `null` passes cleanly.
`verdict-consumer.service.spec.ts` and a new real-Kafka
`verdict-consumer.e2e-spec.ts` case both cover a malformed message on
the wire never crash-looping the consumer.
