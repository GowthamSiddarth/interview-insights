-- AlterTable
ALTER TABLE "round_ratings" ADD COLUMN "moderation_verdict" JSONB;
ALTER TABLE "recruiter_ratings" ADD COLUMN "moderation_verdict" JSONB;
ALTER TABLE "overall_reviews" ADD COLUMN "moderation_verdict" JSONB;
