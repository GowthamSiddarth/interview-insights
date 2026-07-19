-- Lets recruiter identity resolution (find-or-create by hashed identifier)
-- be a safe upsert instead of a racy find-then-create, mirroring
-- candidates.email_hash's existing unique constraint.
CREATE UNIQUE INDEX "recruiters_company_id_internal_identifier_hash_key" ON "recruiters"("company_id", "internal_identifier_hash");
