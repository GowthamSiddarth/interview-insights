# Phase 42, Issue #592 — seed-demo-data: Vary `staff`/`moderator`/`admin` Roles Across Seeded Moderators

*Part of Phase 42 — Staff Role Hierarchy & Admin/Moderator Tooling.
See `docs/ROADMAP.md` Phase 42 and `docs/DECISIONS.md` D99.*

## The gap this closed

`seedModerators()` (Phase 41, issue #524) already created a handful of
real `Moderator` rows so the queue's claim/release UI had something
realistic to demo against. It predated this entire phase, so every
seeded row landed at `role`'s schema default — `moderator` — regardless
of how many were created. A fresh demo environment after #588/#591
shipped would have every permission-gating code path built and wired,
and nothing to actually click through it with: no seeded `staff` account
to prove the read-only UI, no seeded second `admin` to prove the
staff-management screens work for someone other than the one root
identity.

## Key concept: cycle by index, not by a fixed split tied to today's count

```ts
const SEED_ROLE_CYCLE: StaffRole[] = ['staff', 'moderator', 'admin'];

export async function seedModerators(
  prisma: PrismaService,
  count: number = SEED_MODERATOR_COUNT,
): Promise<string[]> {
  const moderatorIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const role = SEED_ROLE_CYCLE[i % SEED_ROLE_CYCLE.length];
    const passwordHash = await bcrypt.hash(faker.internet.password(), 10);
    const moderator = await prisma.moderator.create({
      data: {
        username: `seed-${role}-${faker.string.alphanumeric(8).toLowerCase()}`,
        email: faker.internet.email(),
        passwordHash,
        role,
      },
    });
    moderatorIds.push(moderator.id);
  }
  return moderatorIds;
}
```

The obvious first instinct — hardcode something like "2 moderators, 1
staff, 1 admin" for `SEED_MODERATOR_COUNT`'s current value of 4 — would
have silently broken the moment that constant changed for an unrelated
reason (say, a future issue needing more seeded claimers). Cycling by
`i % SEED_ROLE_CYCLE.length` instead guarantees at least one of each
tier no matter what `count` is, including a caller-supplied override —
the same robustness this file's `pickModerationOutcome()`/
`pickFlagReason()` already apply to keeping their own output varied
regardless of how many times they're called.

## Key concept: the username is now a label, not just an identifier

Usernames changed from `seed-moderator-<random>` to
`seed-<role>-<random>` — `seed-staff-a1b2c3d4`, `seed-admin-e5f6g7h8`,
and so on. This is a small thing with an outsized effect on actually
using the seeded data: without it, telling which of four
indistinguishable `seed-moderator-*` rows is the one `admin` account
requires a database query. With the role in the username, the
`/moderation/staff` list #591 just built is self-explanatory at a
glance — exactly the kind of detail that matters for demo/dev data,
whose entire purpose is being immediately legible to whoever's looking
at it, not just technically correct.

## Verification

New test case asserting the exact role sequence a 5-account seed run
produces (`['staff', 'moderator', 'admin', 'staff', 'moderator']`,
proving the cycle wraps correctly past `SEED_ROLE_CYCLE.length`) and
that every generated username actually starts with `seed-<that row's
role>-`, not just that the roles vary in aggregate. Existing coverage
(unique usernames across a default-count run, an explicit count
override) needed no changes — this issue only added a new field to the
`create()` call, it didn't change how many rows get created or how their
identity is generated. `npx tsc --noEmit` and `npm run lint` clean.
