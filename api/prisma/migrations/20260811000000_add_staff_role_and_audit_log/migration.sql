-- GitHub issue #586 (Phase 42, D99) — StaffRole hierarchy (admin >
-- moderator > staff) and a durable staff_audit_log table for every admin
-- action against a staff account.
--
-- role defaults to 'moderator' so the existing seeded rows (the one root
-- admin identity plus any seed-demo-data moderators) stay valid without a
-- backfill statement; AdminAuthService.onModuleInit is updated in this same
-- issue to explicitly set role = 'admin' on its upsert of the root
-- identity, so the root account becomes a real admin the next time the api
-- boots, without this migration needing to know which username that is.
--
-- Hand-authored and applied via `prisma migrate deploy` rather than
-- `migrate dev` — `migrate dev`'s shadow-database replay fails against this
-- schema (issue #369's company-moderation-backfill migration queries
-- `_prisma_migrations` directly, tripping P1014 against an empty shadow
-- database), same pre-existing workaround D64 documents.

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('staff', 'moderator', 'admin');

-- CreateEnum
CREATE TYPE "StaffAuditAction" AS ENUM ('account_created', 'role_changed', 'deactivated', 'reactivated', 'password_reset');

-- AlterTable
ALTER TABLE "moderators"
    ADD COLUMN "role" "StaffRole" NOT NULL DEFAULT 'moderator',
    ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "created_by_id" UUID;

-- AddForeignKey
ALTER TABLE "moderators"
    ADD CONSTRAINT "moderators_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "moderators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "staff_audit_log" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "target_id" UUID NOT NULL,
    "action" "StaffAuditAction" NOT NULL,
    "detail" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_audit_log_target_id_created_at_idx" ON "staff_audit_log"("target_id", "created_at");

-- CreateIndex
CREATE INDEX "staff_audit_log_actor_id_created_at_idx" ON "staff_audit_log"("actor_id", "created_at");

-- AddForeignKey
ALTER TABLE "staff_audit_log"
    ADD CONSTRAINT "staff_audit_log_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "moderators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_audit_log"
    ADD CONSTRAINT "staff_audit_log_target_id_fkey"
    FOREIGN KEY ("target_id") REFERENCES "moderators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
