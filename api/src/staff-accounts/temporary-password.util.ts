import { randomBytes } from 'crypto';

// Same entropy/encoding as infra/scripts/rotate-admin-credentials.sh's
// `openssl rand -base64 24` — shown to the caller exactly once, in the
// create/reset-password response body, never persisted or logged in
// plaintext anywhere.
export function generateTemporaryPassword(): string {
  return randomBytes(18).toString('base64');
}
