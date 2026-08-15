-- GitHub issue #679 (Phase 48, D104) — candidates were the only actor
-- still on magic-link-only auth; this brings them to parity with
-- admin-auth's password + bcrypt pattern (AdminAuthService/Moderator).
-- password_hash/password_set_at are nullable: every pre-existing
-- candidate row has never set one, and a magic-link login still works
-- without a password ever being set. token_version starts at 0 and is
-- bumped on every password change/reset to invalidate JWTs issued
-- before that point.
--
-- Hand-authored and applied via `prisma migrate deploy` rather than
-- `migrate dev` — `migrate dev`'s shadow-database replay fails against
-- this schema (D64, same pre-existing workaround #485/#486 already use).

-- AlterTable
ALTER TABLE "candidates" ADD COLUMN "password_hash" TEXT;
ALTER TABLE "candidates" ADD COLUMN "password_set_at" TIMESTAMPTZ;
ALTER TABLE "candidates" ADD COLUMN "token_version" INTEGER NOT NULL DEFAULT 0;
