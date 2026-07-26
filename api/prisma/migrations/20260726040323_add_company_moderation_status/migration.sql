-- AlterEnum
ALTER TYPE "ModerationEntityType" ADD VALUE 'company';

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "status" "ModerationStatus" NOT NULL DEFAULT 'pending';
