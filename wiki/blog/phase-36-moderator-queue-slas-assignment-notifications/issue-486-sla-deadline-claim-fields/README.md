# Phase 36, Issue #486 — SLA Deadline + Claim Fields on `ModerationQueueEntry`

*Part of Phase 36 — Moderator Queue SLAs, Assignment & Notifications. See
`docs/ROADMAP.md` Phase 36 and `docs/DECISIONS.md` D80.*

## The gap this closed

#487 (claim/release endpoints) and #488 (SLA breach detection) both need
real columns to operate on — a deadline to compare against, and a
manual-claim assignment to record. Neither existed on
`moderation_queue`. This issue adds exactly the schema, with no
behavior built on top of it yet (that's #487/#488) — three new columns:
`sla_deadline`, `claimed_by`, `claimed_at`.

## Key concept: the SLA clock starts at entry creation, computed in app code

Phase 36's planning pass (D80) resolved this explicitly: the deadline is
`created_at` + a configurable number of hours (default 48,
`MODERATION_SLA_HOURS`), set the moment an entry enters the queue — not
at first moderator view, which would need a new view-tracking event this
project has no other use for. Computed in `ModerationService.enqueue()`/
`reenqueue()`, not a static DB `DEFAULT`, because the configurable-hours
value lives in app config, which a column default can't read:

```ts
private computeSlaDeadline(): Date {
  return new Date(Date.now() + getModerationSlaHours() * 60 * 60 * 1000);
}
```

The column still keeps a DB-level `DEFAULT (now() + 48h)` as a pure
safety net for any insert path that forgets to set it explicitly — every
real insert path always passes the actual value itself.

## Key concept: backfilling existing rows from their own `created_at`, not migration time

The migration adds `sla_deadline` as nullable first, backfills every
existing row, then flips it to `NOT NULL`:

```sql
ALTER TABLE "moderation_queue" ADD COLUMN "sla_deadline" TIMESTAMPTZ;
UPDATE "moderation_queue" SET "sla_deadline" = "created_at" + INTERVAL '48 hours' WHERE "sla_deadline" IS NULL;
ALTER TABLE "moderation_queue" ALTER COLUMN "sla_deadline" SET NOT NULL;
```

The backfill computes each row's deadline from its *own* `created_at`,
not from the moment the migration happens to run. A row that's already
been sitting in the queue for a week gets a deadline consistent with
when it actually arrived — not one that's suddenly 48 hours in the
future just because the migration ran today, which would silently erase
an already-real SLA breach the moment this feature shipped.

## Key concept: `claimed_by` is a real FK, `reviewed_by` still isn't

`claimed_by` references `moderators.id` with `ON DELETE SET NULL` — a
genuine foreign key, unlike `reviewed_by` (still free text) or the
polymorphic `entity_type`/`entity_id` pair (deliberately not an FK, see
`docs/DATA_MODEL.md`). This is possible now specifically because #485
gave this project a real `Moderator` table to point at; before that,
there was nothing to reference. `reviewed_by` staying free text is a
scope boundary, not an oversight — converting it wasn't part of this
issue or named as a specific follow-up.

## Step-by-step: what actually got built and verified

1. Hand-authored migration (`20260804000000_add_moderation_queue_sla_claim_fields`,
   `prisma migrate deploy`, same shadow-database-replay workaround
   #485's own migration needed): `sla_deadline` (backfilled, then
   `NOT NULL`), `claimed_by` (nullable FK → `moderators`), `claimed_at`
   (nullable).
2. New `api/src/moderation/moderation-sla.env.ts` —
   `getModerationSlaHours()`, same empty-string-means-unset convention
   as this project's other optional numeric env vars, rejecting a
   non-positive value outright.
3. `ModerationService.enqueue()`/`reenqueue()` both compute and set
   `slaDeadline` on every new/re-enqueued entry.
4. `docs/DATA_MODEL.md` and `docs/ROADMAP.md` updated in the same PR —
   the full D80 write-up (and `reviewed_by`'s own eventual FK
   conversion, named as an aspiration but never assigned to a specific
   issue) were deliberately left for #491.
5. 448 unit tests and 28 e2e (`moderation`) tests green, migration
   verified applied to both dev and test Postgres via `migrate deploy`.

## What this enabled

`slaDeadline`/`claimedById`/`claimedAt` existing as real columns is what
let #487 (claim/release endpoints), #488 (the breach-detection sweep),
and #490 (the queue UI's time-remaining badge) all get built directly
on top of this schema, with zero further migrations needed for any of
the three.
