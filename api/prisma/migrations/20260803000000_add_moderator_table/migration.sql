-- GitHub issue #485 (Phase 36) — replaces the single shared
-- ADMIN_USERNAME/ADMIN_PASSWORD_HASH credential with a real Moderator
-- identity table. AdminAuthService.onModuleInit seeds today's
-- env-configured credential into a row so login keeps working; no data
-- migration needed here.
--
-- Hand-authored and applied via `prisma migrate deploy` rather than
-- `migrate dev`: `migrate dev`'s shadow-database replay fails against
-- this schema (issue #369's company-moderation-backfill migration
-- queries `_prisma_migrations` directly, tripping P1014 against an
-- empty shadow database) — same pre-existing workaround D64 documents.

-- CreateTable
CREATE TABLE "moderators" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderators_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "moderators_username_key" ON "moderators"("username");
