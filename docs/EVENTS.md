# Domain events

Event-publishing contract for Phase 30 (Event-Driven Foundation, D53) and
its two downstream consumers, Phase 31 (Notification Service) and Phase 32
(Review Analyzer Service). See `docs/ARCHITECTURE.md` for how the broker
fits into the rest of the system and `docs/DECISIONS.md` D53 for why this
exists at all — this doc is just the contract: what a domain event looks
like, how it's published, and how it's versioned.

## Status

`api/src/events/` (GitHub issue #331) is the reusable plumbing:
`DomainEventPublisher`. As of GitHub issue #332, `ModerationService`
publishes all six event types below from the real write paths — every
incremental create endpoint, the bulk-submission path, and every
approve/reject/flag decision — and `EventsModule` is imported into
`AppModule` (via `ModerationModule`). As of GitHub issue #335,
`notification-service` is the first real consumer — it subscribes to
all three `*.created` topics and sends a "your submission is pending
review" email, idempotently (`services/notification-service/src/
notifications/`, dedupes on entityType+entityId+eventType via its own
`NotificationLog` table). As of GitHub issue #336, the same consumer
also subscribes to all three `*.status_changed` topics and sends an
approved/rejected email — `newStatus: 'flagged'` is a deliberate no-op
(no email, no `NotificationLog` row), since `ModerationService.review()`
rejects re-reviewing an entry that already has `reviewedAt` set, so a
flagged item never gets a second status_changed event to act on. Phase
31 is fully built out including its blog post. As of GitHub issue #339,
`review-analyzer` is the second real consumer — its own consumer group
(`review-analyzer`, independent of `notification-service`'s) subscribing
to all three `*.created` topics. As of GitHub issue #340, it ports Phase
19 (#163)'s LLM triage logic in (its own read-only Prisma schema, D75/D81)
and publishes a new event, `moderation.<type>.verdict_computed.v1`, which
`api` itself consumes — its first-ever event consumer (own consumer group
`api`), not just a producer — to write `moderationVerdict` and run the
existing (D71) auto-approval flow; see `docs/DECISIONS.md` D81.
`review-analyzer` never writes to `moderation_queue` itself — it only
computes and publishes.

## Publishing semantics

Best-effort, after-commit — the same shape `docs/DECISIONS.md` D16/D17
already established for OpenSearch indexing, extended to a message broker
by D53:

- Publishing happens **after** the DB transaction that owns the write has
  already committed, never inside it. The primary write (Postgres) is the
  source of truth; a domain event is a derived side-effect.
- A publish failure — the broker down, a connection error, anything — is
  caught, logged, and swallowed. It never throws back to the caller and
  never fails or rolls back the write that triggered it.
- `DomainEventPublisher` connects its producer once, in `onModuleInit()`.
  If that connection attempt fails (native dev without `redpanda` running,
  a broker restart mid-deploy, etc.), every `publish()` call is a silent
  no-op: logged at `warn`, not `error`, since an unreachable broker isn't
  necessarily a bug. `.github/workflows/ci.yml`'s `api` job runs a real
  `redpanda` service container (GitHub issue #332) — CI exercises the
  real connect-and-publish path, not just the failure path.

## Versioning convention

Each event type is a TypeScript interface named `<Thing>EventV<n>`, paired
with a topic-name constant of the form
`<domain>.<entity>.<action>.v<n>` — the version number appears in **both**
the type name and the topic name. A breaking change to an event's shape
ships as a new type + new topic (`v2`), not a mutation of `v1` — existing
consumers keep reading the `v1` topic unchanged until they're migrated on
their own schedule, instead of every consumer having to update in
lockstep with the producer.

Non-breaking changes (a new optional field) can be added to the existing
version in place.

## Defined events

Nine event types — one `*.created`, one `*.status_changed`, and (GitHub
issue #340) one `*.verdict_computed` per moderated entity type
(`round_rating`, `recruiter_rating`, `overall_review`). `company` (a
create-company request, Phase 35) is deliberately out of scope for all
three — see `ModerationService.publishCreatedEvent`/
`publishStatusChangedEvent`'s own comments for why, and D81 for why
`review-analyzer` never subscribes to `company`'s own `*.created` topic
either. Every `*.created` event carries `candidateId`/`companyId` context
so a consumer can act without an immediate callback into the monolith;
every `*.status_changed` event additionally carries `previousStatus`
(always `'pending'` — `ModerationService.review()` only ever runs against
an unreviewed entry), `newStatus`, and the optional `reviewedBy` label.
Every `*.verdict_computed` event carries the full LLM verdict payload
(`verdict`, `autoApprovalEligible`, `confidence`, `model`,
`promptContent`, `responseText`) plus an optional `stalled: true` marker
for a reconciliation-sweep escalation with no verdict at all.

| Topic | Type | Schema file |
|---|---|---|
| `moderation.round_rating.created.v1` | `RoundRatingCreatedEventV1` | `api/src/events/schemas/round-rating-created.event.ts` |
| `moderation.round_rating.status_changed.v1` | `RoundRatingStatusChangedEventV1` | `api/src/events/schemas/round-rating-status-changed.event.ts` |
| `moderation.round_rating.verdict_computed.v1` | `RoundRatingVerdictComputedEventV1` | `services/review-analyzer/src/events/schemas/round-rating-verdict-computed.event.ts` (duplicated into `api/src/events/schemas/`) |
| `moderation.recruiter_rating.created.v1` | `RecruiterRatingCreatedEventV1` | `api/src/events/schemas/recruiter-rating-created.event.ts` |
| `moderation.recruiter_rating.status_changed.v1` | `RecruiterRatingStatusChangedEventV1` | `api/src/events/schemas/recruiter-rating-status-changed.event.ts` |
| `moderation.recruiter_rating.verdict_computed.v1` | `RecruiterRatingVerdictComputedEventV1` | `services/review-analyzer/src/events/schemas/recruiter-rating-verdict-computed.event.ts` (duplicated into `api/src/events/schemas/`) |
| `moderation.overall_review.created.v1` | `OverallReviewCreatedEventV1` | `api/src/events/schemas/overall-review-created.event.ts` |
| `moderation.overall_review.status_changed.v1` | `OverallReviewStatusChangedEventV1` | `api/src/events/schemas/overall-review-status-changed.event.ts` |
| `moderation.overall_review.verdict_computed.v1` | `OverallReviewVerdictComputedEventV1` | `services/review-analyzer/src/events/schemas/overall-review-verdict-computed.event.ts` (duplicated into `api/src/events/schemas/`) |

Published from:
- **`*.created`** — `RoundRatingsService.create()`, `RecruiterRatingsService.create()`,
  `OverallReviewsService.create()`, and `BulkProcessSubmissionService.create()`
  (one call per rated/reviewed entity it creates) — all after their
  transaction commits, alongside `indexForSearch()`. LLM triage no longer
  runs synchronously here (moved to `review-analyzer` by #340/D81) — an
  edit (`update()`) resets `moderationVerdict` to null instead, so
  `review-analyzer`'s reconciliation sweep picks the edited row back up
  within its 24h window; there's no `*.created`-shaped event on edit.
- **`*.status_changed`** — `ModerationService.review()`, the shared
  implementation behind `approve()`/`reject()`/`flag()` (and
  `approveWithAudit()`, the AI auto-approval entry point).
- **`*.verdict_computed`** — `review-analyzer`'s `AnalysisConsumerService`
  (a freshly-computed verdict, off a consumed `*.created` event) and its
  own `ReconciliationSweepService` (a re-triaged stale row, or a
  `stalled: true` escalation when even the retry can't produce one).

`moderation.*.created.v1` is consumed by `notification-service` as of
GitHub issue #335 (the "your submission is pending review" email) and,
independently, by `review-analyzer` as of GitHub issue #339 (its own
consumer group — every consumer group gets its own copy of every
message, so one consumer's processing never affects another's; real LLM
triage as of #340).
`moderation.*.status_changed.v1` (the approved/rejected notification) is
consumed by the same `notification-service` consumer as of GitHub issue
#336.
`moderation.*.verdict_computed.v1` is consumed by `api` as of GitHub
issue #340 — its first-ever event consumer (`VerdictConsumerService`,
own consumer group `api`), which writes `moderationVerdict` and, when
`autoApprovalEligible` is true, calls the existing `approveWithAudit()`;
a `stalled: true` event instead calls `ModerationService.flag()`. See
#335/#336/#339/#340 for the actual consumer-side wiring.

## Adding a new event type

1. Add `api/src/events/schemas/<name>.event.ts` — a `v1` type + topic
   constant, following the round-rating example above.
2. Document it in the table above.
3. Call `DomainEventPublisher.publish(topic, event, key)` from the write
   path, after its transaction commits — never inside the transaction,
   and never in a way whose failure could affect the write's own result.
