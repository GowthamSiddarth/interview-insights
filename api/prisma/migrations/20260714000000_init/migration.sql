-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "CompanySizeBucket" AS ENUM ('startup', 'mid', 'large', 'enterprise');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('unverified', 'email_verified', 'document_verified');

-- CreateEnum
CREATE TYPE "ProcessOutcome" AS ENUM ('offer', 'rejected', 'withdrawn', 'ghosted', 'in_progress');

-- CreateEnum
CREATE TYPE "NormalizedBand" AS ENUM ('entry', 'mid', 'senior', 'staff', 'principal', 'manager', 'director', 'exec', 'unmapped');

-- CreateEnum
CREATE TYPE "RoundType" AS ENUM ('coding', 'system_design', 'behavioral', 'leadership', 'case_study', 'assessment', 'take_home', 'other');

-- CreateEnum
CREATE TYPE "ModerationStatus" AS ENUM ('pending', 'approved', 'rejected', 'flagged');

-- CreateEnum
CREATE TYPE "ModerationEntityType" AS ENUM ('round_rating', 'recruiter_rating', 'overall_review');

-- CreateEnum
CREATE TYPE "ModerationFlagReason" AS ENUM ('spam_pattern', 'rate_limit', 'duplicate', 'manual_report');

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "industry" TEXT,
    "size_bucket" "CompanySizeBucket" NOT NULL,
    "logo_url" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidates" (
    "id" UUID NOT NULL,
    "email_hash" TEXT NOT NULL,
    "verification_status" "VerificationStatus" NOT NULL DEFAULT 'unverified',
    "verified_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interview_processes" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "role_title" TEXT NOT NULL,
    "level" TEXT,
    "department" TEXT,
    "application_date" DATE,
    "outcome" "ProcessOutcome" NOT NULL,
    "normalized_band" "NormalizedBand",
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interview_processes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interviewers" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "internal_identifier_hash" TEXT NOT NULL,
    "display_label" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interviewers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruiters" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "internal_identifier_hash" TEXT NOT NULL,
    "display_label" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recruiters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rounds" (
    "id" UUID NOT NULL,
    "process_id" UUID NOT NULL,
    "sequence_number" SMALLINT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "round_type" "RoundType" NOT NULL,
    "interviewer_id" UUID,
    "scheduled_duration_minutes" SMALLINT,
    "type_metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "round_ratings" (
    "id" UUID NOT NULL,
    "round_id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "difficulty" SMALLINT NOT NULL,
    "fairness" SMALLINT NOT NULL,
    "communication_fluency" SMALLINT NOT NULL,
    "attentiveness" SMALLINT NOT NULL,
    "bias_signal" SMALLINT NOT NULL,
    "technical_depth" SMALLINT,
    "free_text" TEXT,
    "status" "ModerationStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "round_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruiter_interactions" (
    "id" UUID NOT NULL,
    "process_id" UUID NOT NULL,
    "recruiter_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recruiter_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruiter_ratings" (
    "id" UUID NOT NULL,
    "recruiter_interaction_id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "approachability" SMALLINT NOT NULL,
    "response_time" SMALLINT NOT NULL,
    "timeliness" SMALLINT NOT NULL,
    "communication_quality" SMALLINT NOT NULL,
    "free_text" TEXT,
    "status" "ModerationStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recruiter_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "overall_reviews" (
    "id" UUID NOT NULL,
    "process_id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "overall_experience" SMALLINT NOT NULL,
    "would_recommend" BOOLEAN NOT NULL,
    "review_text" TEXT,
    "status" "ModerationStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "overall_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderation_queue" (
    "id" UUID NOT NULL,
    "entity_type" "ModerationEntityType" NOT NULL,
    "entity_id" UUID NOT NULL,
    "flag_reason" "ModerationFlagReason",
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_level_mappings" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "raw_level_string" TEXT NOT NULL,
    "normalized_band" "NormalizedBand" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_level_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "companies_slug_key" ON "companies"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "candidates_email_hash_key" ON "candidates"("email_hash");

-- CreateIndex
CREATE INDEX "interview_processes_company_id_role_title_idx" ON "interview_processes"("company_id", "role_title");

-- CreateIndex
CREATE INDEX "interview_processes_company_id_created_at_idx" ON "interview_processes"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "interview_processes_normalized_band_idx" ON "interview_processes"("normalized_band");

-- CreateIndex
CREATE INDEX "rounds_process_id_sequence_number_idx" ON "rounds"("process_id", "sequence_number");

-- CreateIndex
CREATE INDEX "rounds_round_type_idx" ON "rounds"("round_type");

-- CreateIndex
CREATE UNIQUE INDEX "round_ratings_round_id_candidate_id_key" ON "round_ratings"("round_id", "candidate_id");

-- CreateIndex
CREATE UNIQUE INDEX "recruiter_ratings_recruiter_interaction_id_candidate_id_key" ON "recruiter_ratings"("recruiter_interaction_id", "candidate_id");

-- CreateIndex
CREATE UNIQUE INDEX "overall_reviews_process_id_key" ON "overall_reviews"("process_id");

-- CreateIndex
CREATE INDEX "moderation_queue_entity_type_entity_id_idx" ON "moderation_queue"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "company_level_mappings_company_id_raw_level_string_key" ON "company_level_mappings"("company_id", "raw_level_string");

-- AddForeignKey
ALTER TABLE "interview_processes" ADD CONSTRAINT "interview_processes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_processes" ADD CONSTRAINT "interview_processes_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interviewers" ADD CONSTRAINT "interviewers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruiters" ADD CONSTRAINT "recruiters_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_process_id_fkey" FOREIGN KEY ("process_id") REFERENCES "interview_processes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_interviewer_id_fkey" FOREIGN KEY ("interviewer_id") REFERENCES "interviewers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "round_ratings" ADD CONSTRAINT "round_ratings_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "round_ratings" ADD CONSTRAINT "round_ratings_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruiter_interactions" ADD CONSTRAINT "recruiter_interactions_process_id_fkey" FOREIGN KEY ("process_id") REFERENCES "interview_processes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruiter_interactions" ADD CONSTRAINT "recruiter_interactions_recruiter_id_fkey" FOREIGN KEY ("recruiter_id") REFERENCES "recruiters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruiter_ratings" ADD CONSTRAINT "recruiter_ratings_recruiter_interaction_id_fkey" FOREIGN KEY ("recruiter_interaction_id") REFERENCES "recruiter_interactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruiter_ratings" ADD CONSTRAINT "recruiter_ratings_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "overall_reviews" ADD CONSTRAINT "overall_reviews_process_id_fkey" FOREIGN KEY ("process_id") REFERENCES "interview_processes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "overall_reviews" ADD CONSTRAINT "overall_reviews_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_level_mappings" ADD CONSTRAINT "company_level_mappings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CheckConstraints (1-5 rating scales; not expressible in Prisma schema
-- language — see docs/DATA_MODEL.md and the comments on RoundRating /
-- RecruiterRating / OverallReview in prisma/schema.prisma)
ALTER TABLE "round_ratings" ADD CONSTRAINT "round_ratings_difficulty_check" CHECK ("difficulty" BETWEEN 1 AND 5);
ALTER TABLE "round_ratings" ADD CONSTRAINT "round_ratings_fairness_check" CHECK ("fairness" BETWEEN 1 AND 5);
ALTER TABLE "round_ratings" ADD CONSTRAINT "round_ratings_communication_fluency_check" CHECK ("communication_fluency" BETWEEN 1 AND 5);
ALTER TABLE "round_ratings" ADD CONSTRAINT "round_ratings_attentiveness_check" CHECK ("attentiveness" BETWEEN 1 AND 5);
ALTER TABLE "round_ratings" ADD CONSTRAINT "round_ratings_bias_signal_check" CHECK ("bias_signal" BETWEEN 1 AND 5);
ALTER TABLE "round_ratings" ADD CONSTRAINT "round_ratings_technical_depth_check" CHECK ("technical_depth" IS NULL OR "technical_depth" BETWEEN 1 AND 5);

ALTER TABLE "recruiter_ratings" ADD CONSTRAINT "recruiter_ratings_approachability_check" CHECK ("approachability" BETWEEN 1 AND 5);
ALTER TABLE "recruiter_ratings" ADD CONSTRAINT "recruiter_ratings_response_time_check" CHECK ("response_time" BETWEEN 1 AND 5);
ALTER TABLE "recruiter_ratings" ADD CONSTRAINT "recruiter_ratings_timeliness_check" CHECK ("timeliness" BETWEEN 1 AND 5);
ALTER TABLE "recruiter_ratings" ADD CONSTRAINT "recruiter_ratings_communication_quality_check" CHECK ("communication_quality" BETWEEN 1 AND 5);

ALTER TABLE "overall_reviews" ADD CONSTRAINT "overall_reviews_overall_experience_check" CHECK ("overall_experience" BETWEEN 1 AND 5);
