-- CreateTable
-- GitHub issue #440 (Phase 39, D71) — append-only audit trail for every
-- system-attributed auto-approval decision. Deliberately a separate table
-- from round_ratings/recruiter_ratings/overall_reviews.moderation_verdict
-- (mutable JSONB) so this row survives a later human override or re-triage
-- of that same column.
CREATE TABLE "ai_auto_approval_audit" (
    "id" UUID NOT NULL,
    "entity_type" "ModerationEntityType" NOT NULL,
    "entity_id" UUID NOT NULL,
    "moderation_queue_entry_id" UUID NOT NULL,
    "prompt_content" TEXT NOT NULL,
    "response_text" TEXT NOT NULL,
    "verdict" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "model" TEXT NOT NULL,
    "decision" "ModerationStatus" NOT NULL DEFAULT 'approved',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_auto_approval_audit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_auto_approval_audit_entity_type_entity_id_idx" ON "ai_auto_approval_audit"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "ai_auto_approval_audit" ADD CONSTRAINT "ai_auto_approval_audit_moderation_queue_entry_id_fkey" FOREIGN KEY ("moderation_queue_entry_id") REFERENCES "moderation_queue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
