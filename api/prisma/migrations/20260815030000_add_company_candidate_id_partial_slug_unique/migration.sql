-- GitHub issue #696 (Phase 50, D104) — a rejected company-creation
-- request no longer permanently occupies its slug: the plain unique
-- index on companies.slug is replaced with a partial unique index
-- scoped to pending/approved rows only. Prisma's schema DSL can't
-- express a filtered/partial unique constraint, so this constraint
-- exists only here, not as a matching @@unique in schema.prisma.
DROP INDEX "companies_slug_key";

CREATE UNIQUE INDEX "companies_slug_pending_approved_key"
    ON "companies" ("slug")
    WHERE "status" IN ('pending', 'approved');

-- Who requested this company. Nullable (seed/admin-created companies
-- have no requester) and ON DELETE SET NULL, not RESTRICT — a Company is
-- shared platform data (other candidates' InterviewProcess rows may
-- already reference it), so a GDPR erasure of the requesting candidate
-- must anonymize this reference rather than be blocked by it.
ALTER TABLE "companies" ADD COLUMN "candidate_id" UUID;

ALTER TABLE "companies"
    ADD CONSTRAINT "companies_candidate_id_fkey"
    FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
