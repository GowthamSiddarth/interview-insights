type AdminEnvKey = 'ADMIN_USERNAME' | 'ADMIN_PASSWORD_HASH' | 'ADMIN_JWT_SECRET';

// Same lazy-throw-on-use pattern as candidates.service.ts's
// getEmailHashSecret() — no env validation at app boot, only when the
// value is actually needed (login attempt / token issuance).
export function getRequiredAdminEnv(key: AdminEnvKey): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`${key} must be set for admin authentication.`);
  }
  return value;
}
