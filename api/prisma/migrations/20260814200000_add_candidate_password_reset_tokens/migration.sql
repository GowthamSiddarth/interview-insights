-- GitHub issue #682 (Phase 48, D104) — forgot-password flow. Same shape
-- as candidate_verification_tokens: hashed, single-use, short-lived — a
-- separate table so a leaked/guessed magic-link token can never be used
-- to reset a password, and vice versa.
--
-- Hand-authored and applied via `prisma migrate deploy` rather than
-- `migrate dev` — `migrate dev`'s shadow-database replay fails against
-- this schema (D64, same pre-existing workaround #485/#486/#679 already
-- use).

-- CreateTable
CREATE TABLE "candidate_password_reset_tokens" (
    "id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "consumed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "candidate_password_reset_tokens_token_hash_key" ON "candidate_password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "candidate_password_reset_tokens_candidate_id_idx" ON "candidate_password_reset_tokens"("candidate_id");

-- AddForeignKey
ALTER TABLE "candidate_password_reset_tokens" ADD CONSTRAINT "candidate_password_reset_tokens_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
