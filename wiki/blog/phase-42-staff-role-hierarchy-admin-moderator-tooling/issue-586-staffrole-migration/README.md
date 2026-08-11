# Phase 42, Issue #586 — Prisma Migration: `StaffRole`, `role`/`isActive`/`createdById`, `staff_audit_log`

*Part of Phase 42 — Staff Role Hierarchy & Admin/Moderator Tooling.
See `docs/ROADMAP.md` Phase 42 and `docs/DECISIONS.md` D99.*

## The gap this closed

D99 settled the shape — extend `moderators` rather than rename it, add
a durable audit table — but none of it existed in the schema yet. This
issue was the first concrete implementation step: turn the decision
record into an actual migration, and make sure the one row that already
existed (the boot-seeded root identity, plus whatever `seed-demo-data`
had created) survived the change without a manual data-backfill step.

## Key concept: a schema default that's also a correctness argument

```prisma
model Moderator {
  id           String    @id @default(uuid()) @db.Uuid
  username     String    @unique
  passwordHash String    @map("password_hash")
  email        String
  role         StaffRole @default(moderator)
  isActive     Boolean   @default(true) @map("is_active")
  createdById  String?   @map("created_by_id") @db.Uuid
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz
  ...
}
```

`role` defaults to `moderator`, not `staff` or `admin`. That's not an
arbitrary choice — every existing row in this table, before this
migration ever ran, was either the one root admin identity or a
`seed-demo-data`-created row, and both were *acting* as moderators in
practice (full claim/approve/reject/flag access, gated by the single
shared credential). Defaulting to `moderator` means the migration itself
needs no data-backfill statement: every pre-existing row stays exactly
as capable as it was the moment before the migration ran, and the one
row that actually needs to be more than a moderator — the root identity
— gets promoted explicitly by application code, not by the migration
guessing which username that is.

## Key concept: application code closes the gap a migration can't

```ts
// AdminAuthService.onModuleInit()
await this.prisma.moderator.upsert({
  where: { username },
  create: { username, passwordHash, email, role: 'admin', isActive: true },
  update: { passwordHash, email, role: 'admin', isActive: true },
});
```

The migration has no way to know which username is the root `ADMIN_USERNAME`
— that's an env var, not a fact the schema layer can see. So
`AdminAuthService.onModuleInit()`, which already upserts this identity
on every boot (Phase 36, issue #485), was extended to set `role: 'admin'`
explicitly on both the create and update branches. This runs on every
boot, not just once, so the root identity becomes a real `ADMIN` the
very next time `api` starts after this migration lands — no separate
manual promotion step, no window where the root account is a real
`ADMIN` in the database but the running process doesn't know it yet.

## Key concept: `staff_audit_log` follows an existing precedent, not a new pattern

```prisma
model StaffAuditLog {
  id        String           @id @default(uuid()) @db.Uuid
  actorId   String           @map("actor_id") @db.Uuid
  targetId  String           @map("target_id") @db.Uuid
  action    StaffAuditAction
  detail    Json?
  createdAt DateTime         @default(now()) @map("created_at") @db.Timestamptz

  actor  Moderator @relation("StaffAuditActor", fields: [actorId], references: [id])
  target Moderator @relation("StaffAuditTarget", fields: [targetId], references: [id])

  @@index([targetId, createdAt])
  @@index([actorId, createdAt])
  @@map("staff_audit_log")
}
```

This shape — a real FK to the acted-on row, a `Json` detail column for
extensibility, its own denormalized queryable columns, an index on the
lookup pair — deliberately mirrors `AiAutoApprovalAudit` (D71), this
project's existing precedent for "durable, never best-effort" audit
tables. `actorId` and `targetId` are separate columns rather than a
single "who did this" field specifically so a self-service password
change (actor acting on themselves) and an admin-initiated action
(actor acting on someone else) are both representable without a third
"is this self-service" boolean — the distinction is already fully
captured by whether the two ids match.

## Migrating by hand, not `migrate dev`

Like the `moderators` table's own original migration (#485), this one
was hand-authored and applied via `prisma migrate deploy` rather than
`migrate dev` — `migrate dev`'s shadow-database replay fails against
this schema (issue #369's company-moderation-backfill migration queries
`_prisma_migrations` directly, tripping P1014 against an empty shadow
database), the same pre-existing workaround D64 documents. Nothing new
here, just another migration that has to follow the established
workaround rather than the tool's own default path.

## Verification

Applied for real against the live kind cluster's Postgres, not just
CI's ephemeral one: `kubectl port-forward svc/postgres` into a local
port, then `prisma migrate deploy` directly. The pre-existing root
`admin` row came back with `role: 'moderator'` (the schema default) as
expected — restarting `api` afterward is what actually promotes it, not
the migration itself — and `staff_audit_log` came up empty with no
errors. Confirmed backward-compatible with the *already-running* `api`
pod too: an old Prisma client that has never heard of these three new
columns or the new table doesn't choke on their existence, so this
migration is safe to apply ahead of the code that actually uses it, the
normal shape of a safe additive migration. `npx tsc --noEmit`, the full
unit suite (`admin-auth.service.spec.ts` updated for the new `upsert`
call shape), and `npm run lint` all clean.
