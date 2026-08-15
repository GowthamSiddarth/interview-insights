# Phase 48, Issue #679 — Candidate Schema Migration for Password Auth

*Part of Phase 48 — Candidate Password Authentication.
See `docs/ROADMAP.md` Phase 48, D104.*

## The gap this closed

An audit of this project's auth surfaces found candidates were the only
actor left on magic-link-only authentication. Staff accounts
(`Moderator`, Phase 36/42) already had a proven password + bcrypt +
`tokenVersion`-less pattern in production; candidates had none of it —
`Candidate` had no `passwordHash` column at all. This issue is purely the
schema half of closing that gap: three new columns, no behavior yet.

```prisma
model Candidate {
  // ...
  passwordHash  String?   @map("password_hash")
  passwordSetAt DateTime? @map("password_set_at") @db.Timestamptz
  tokenVersion  Int       @default(0) @map("token_version")
}
```

`passwordHash`/`passwordSetAt` are nullable — every pre-existing
candidate row has never set one, and a magic-link login keeps working
without a password ever existing. `tokenVersion` is new territory for
this project's candidate sessions: a counter, defaulted to `0`, that a
later issue (#682) bumps on every password reset to invalidate every JWT
issued before that point.

## Why `migrate deploy`, not `migrate dev`

This project's Prisma migrations are supposed to be generated via
`prisma migrate dev --name <change>`, which diffs the schema against a
disposable shadow database. That command has failed against this
project's migration history since Phase 36 (D64) — a specific earlier
migration's DDL doesn't replay cleanly on an empty shadow database. The
established workaround (`#485`/`#486` already use it) is to hand-author
`migration.sql` and apply it directly with `prisma migrate deploy`,
which doesn't need a shadow database at all:

```sql
ALTER TABLE "candidates" ADD COLUMN "password_hash" TEXT;
ALTER TABLE "candidates" ADD COLUMN "password_set_at" TIMESTAMPTZ;
ALTER TABLE "candidates" ADD COLUMN "token_version" INTEGER NOT NULL DEFAULT 0;
```

Straightforward here since it's three additive, nullable-or-defaulted
columns on an existing table — no backfill, no lock contention concern
beyond what any `ALTER TABLE ADD COLUMN` briefly takes.

## Verification

Applied against the local dev database (the `kind` cluster's Postgres,
reached via the standing `kubectl port-forward`), followed by `prisma
generate` to regenerate the client's types, then the full existing test
suite (521 tests at the time) to confirm nothing downstream broke from
the new nullable columns. No new tests of its own — there's no behavior
yet to test, just a widened schema that #680-#682 build on.
