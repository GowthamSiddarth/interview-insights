# Phase 41, Issue #524 — seed-demo-data: Simulate Moderator Claims and Vary `flagReason` Across the Full Enum

*Part of Phase 41 — Moderator Queue Priority, Filters & Seed-Data Parity.
See `docs/ROADMAP.md` Phase 41.*

## The gap this closed

`api/scripts/seed-demo-data.ts` predates both Phase 36 (moderator
identity/claim) and Phase 39 (LLM auto-approval) and was never extended
for either. Two concrete symptoms: it never touched `Moderator` rows or
claim state at all (`reviewedBy: SEEDER_LABEL`, a free-text string, not a
real moderator id — the moderation system's actual production shape since
Phase 36), and `applyModerationOutcome()` hardcoded
`flagReason: 'manual_report'` for every single flagged entry instead of
drawing from the full `ModerationFlagReason` enum.

That second gap in particular meant #522 and #523's new `claimState` and
`status` filters would have nothing representative to demo against on a
freshly seeded dev instance — every entry unclaimed, every flag reason
identical. This issue's whole purpose was closing that gap so the other
two issues' work is actually exercisable, not just theoretically correct.

## Seeding moderators without a `ModeratorsService`

Every other seeded entity in this script goes through a real service —
`CompaniesService`, `CandidatesService`, and so on — deliberately, so the
seed script can't silently diverge from production write paths. There is
no `ModeratorsService` to go through for `Moderator` rows: the only
existing creation path, `AdminAuthService.onModuleInit()`, is env-driven
and upserts exactly one row from `ADMIN_USERNAME`/`ADMIN_PASSWORD_HASH`,
not built for stamping out several synthetic accounts. A `Moderator` row
also has no side effects to protect against bypassing — no search
indexing, no domain events — unlike a company or a rating. Raw
`prisma.moderator.create()` was the pragmatic choice here, flagged
explicitly in code as a deliberate exception rather than an oversight:

```ts
export const SEED_MODERATOR_COUNT = 4;

export async function seedModerators(
  prisma: PrismaService,
  count: number = SEED_MODERATOR_COUNT,
): Promise<string[]> {
  const moderatorIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const passwordHash = await bcrypt.hash(faker.internet.password(), 10);
    const moderator = await prisma.moderator.create({
      data: {
        username: `seed-moderator-${faker.string.alphanumeric(8).toLowerCase()}`,
        email: faker.internet.email(),
        passwordHash,
      },
    });
    moderatorIds.push(moderator.id);
  }
  return moderatorIds;
}
```

## Claiming through the real path, unlike creating the moderators themselves

Having decided direct Prisma writes were fine for the moderators
themselves, the script still routes the actual *claiming* of queue
entries through `ModerationService.claim()` — the real production
endpoint's own service method, not a raw `claimedById` update. Claiming
does have a meaningful side effect (it's the exact call `claim()`/
`release()` UI actions trigger in production, and #522's `claimState`
filter needs to see real claimed state, not a shortcut that happens to
look the same):

```ts
export const PENDING_CLAIM_RATE = 0.3;

if (outcome === 'pending') {
  if (moderatorIds.length === 0 || Math.random() >= PENDING_CLAIM_RATE) return;
  const entry = await prisma.moderationQueueEntry.findFirst({
    where: { entityType, entityId, reviewedAt: null },
  });
  if (!entry) return; // shouldn't happen, but never crash a whole run over one entity
  await moderationService.claim(entry.id, faker.helpers.arrayElement(moderatorIds));
  summary.claimed++;
  return;
}
```

About 30% of generated pending entries get claimed this way — enough for
the queue's "claimed by X" badge and the `claimState` filter to have
something realistic to show, without claiming so much of the queue that
"unclaimed" stops being a meaningful demo state.

## Varying `flagReason`

The actual one-line fix at the center of this issue:

```ts
export function pickFlagReason(): ModerationFlagReason {
  return faker.helpers.arrayElement(Object.values(ModerationFlagReason));
}
```

...replacing the hardcoded `flagReason: 'manual_report'` in
`applyModerationOutcome()`'s flagged branch with `pickFlagReason()`. This
includes `ai_triage_stalled` — D71/D72's reconciliation-sweep-only
reason from Phase 39 — in the draw pool. That's synthetic demo data, not
a claim about how any specific seeded entry was actually triaged; the
comment in the code is explicit about that distinction so a future reader
doesn't mistake seeded `ai_triage_stalled` entries for evidence the sweep
itself ran during seeding.

## Explicit non-goal: `moderationVerdict`

`moderationVerdict` population (Phase 39's LLM auto-approval writing back
a verdict) stays entirely out of scope here — it depends on
`review-analyzer` actually being live and consuming the real
`*.created.v1` events the seed run emits, which can race with the
script's own explicit `approve`/`reject`/`flag` calls. The script's
existing `findFirst({ reviewedAt: null })` guard already no-ops
gracefully if that race resolves in `review-analyzer`'s favor first —
faking `moderationVerdict` directly here would mean maintaining a second,
parallel model of what auto-approval produces, exactly the kind of
divergence this script's "go through real services" discipline exists to
avoid.

## One deliberate loose end

Seeded `Moderator` rows are **not** cleaned up by
`seed-demo-data-undo.ts` — that script's undo only reverses company/
candidate-scoped data anchored to its existing `SeedManifest`, matching
this issue's own scope exactly. Fine for a dev/test database that gets
reset wholesale between runs; flagged directly in the PR description as
something that may need a follow-up if moderator rows accumulate across
many seed/undo cycles on a longer-lived instance, rather than silently
left for someone to discover later.

## Verification

New unit coverage: `pickFlagReason` proven to only ever return a valid
enum member across 50 draws, and — separately — proven capable of
returning *every* member across 500 draws (guarding against a
`faker.helpers.arrayElement` regression that happened to always pick the
same value). `seedModerators` proven to create exactly the requested
count with unique usernames (a collision would violate the
`moderators.username` unique constraint against a real database) and to
honor an explicit count override. `npx tsc --noEmit` and `npx eslint`
clean; the e2e suite against real Postgres/OpenSearch needed local infra
up and was left as a manual follow-up in the PR's own test plan.
