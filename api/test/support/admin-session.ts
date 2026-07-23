import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';

// Fixed test-only credentials, shared across every e2e spec that needs to
// call a moderation route (GitHub issue #159, Phase 18). ADMIN_PASSWORD_HASH
// as set in CI (.github/workflows/ci.yml) and documented in
// api/.env.example is a precomputed bcrypt hash of this exact plaintext —
// never a real credential.
export const ADMIN_TEST_USERNAME = 'admin';
export const ADMIN_TEST_PASSWORD = 'dev-only-admin-password';

// Logs in once and returns the raw Set-Cookie value so callers can attach
// it via .set('Cookie', ...) to any subsequent supertest request.
export async function loginAsAdmin(app: INestApplication): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- getHttpServer()'s return type doesn't line up with supertest's App type
  const res = await request(app.getHttpServer())
    .post('/auth/admin/login')
    .send({ username: ADMIN_TEST_USERNAME, password: ADMIN_TEST_PASSWORD })
    .expect(200);
  const cookies = res.headers['set-cookie'] as unknown as string[] | string | undefined;
  if (!cookies || (Array.isArray(cookies) && cookies.length === 0)) {
    throw new Error('Admin login did not set a session cookie.');
  }
  return Array.isArray(cookies) ? cookies[0] : cookies;
}
