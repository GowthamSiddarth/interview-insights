// Same lazy-throw-on-use pattern as admin-auth.env.ts / candidates.service.ts's
// getEmailHashSecret() — no env validation at app boot beyond the JWT
// strategy's own super() call, which needs this synchronously.
export function getRequiredCandidateJwtSecret(): string {
  const value = process.env.CANDIDATE_JWT_SECRET;
  if (!value) {
    throw new Error('CANDIDATE_JWT_SECRET must be set for candidate authentication.');
  }
  return value;
}
