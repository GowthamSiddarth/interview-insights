-- CreateTable
CREATE TABLE "candidate_verification_tokens" (
    "id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "consumed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "candidate_verification_tokens_token_hash_key" ON "candidate_verification_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "candidate_verification_tokens_candidate_id_idx" ON "candidate_verification_tokens"("candidate_id");

-- AddForeignKey
ALTER TABLE "candidate_verification_tokens" ADD CONSTRAINT "candidate_verification_tokens_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
