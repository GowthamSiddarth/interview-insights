import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assertLocalE2eIsolation } from './support/assert-test-database';

// GitHub issue #452 — regression test for the dotenv load-order bug:
// getRequiredAdminEnv() (called eagerly from admin-auth.module.ts, at
// module-evaluation time) threw "ADMIN_JWT_SECRET must be set" on a bare
// `npm run start:dev`, even with a real ADMIN_JWT_SECRET present in
// api/.env — nothing in api/src called dotenv explicitly, so `.env` only
// reached process.env as an incidental side effect of @prisma/client's own
// auto-loading, and whether that side effect had already run by the time
// AdminAuthModule's eager read fired depended entirely on module require
// order. main.ts's `import 'dotenv/config'` (now its first import, ahead
// of `./app.module`) fixes this for every env var, not just this one.
//
// Reproduces the issue's exact repro: an app boot with nothing
// pre-exported into the process environment — every var comes only from a
// `.env` file on disk (here, DOTENV_CONFIG_PATH points at a throwaway one
// instead of api/.env, so this doesn't depend on — or clobber — a
// developer's real one).
//
// Opt-in only (`npm run smoke:e2e`), same as golden-path.smoke-spec.ts —
// spawns a real `ts-node` boot against the real port-forwarded
// Postgres/OpenSearch from infra/scripts/dev-port-forwards.sh, so it can't
// run in CI.
describe('main.ts env load order (e2e smoke test)', () => {
  let child: ChildProcess | undefined;
  let tmpDir: string | undefined;

  afterEach(() => {
    child?.kill();
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('boots successfully with only a .env file on disk — nothing pre-exported', async () => {
    assertLocalE2eIsolation('npm run smoke:e2e');

    const port = 3199;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ii-env-load-order-'));
    const envPath = path.join(tmpDir, '.env');
    fs.writeFileSync(
      envPath,
      [
        `DATABASE_URL=${process.env.DATABASE_URL ?? ''}`,
        `OPENSEARCH_URL=${process.env.OPENSEARCH_URL ?? 'http://localhost:9200'}`,
        `OPENSEARCH_INDEX_PREFIX=${process.env.OPENSEARCH_INDEX_PREFIX ?? ''}`,
        `PORT=${port}`,
        `CORS_ORIGIN=http://localhost:3000`,
        `EMAIL_HASH_SECRET=test-email-hash-secret`,
        `ADMIN_USERNAME=admin`,
        // Same fixture hash as test/support/admin-session.ts — bcrypt of
        // "dev-only-admin-password", not a real credential.
        `ADMIN_PASSWORD_HASH=$2b$10$5d3GXDikXoI./2wvbNoUIeG2/aoU72AKnueOEYLMYOxoeL8vD5dlG`,
        `ADMIN_JWT_SECRET=test-admin-jwt-secret`,
        `CANDIDATE_JWT_SECRET=test-candidate-jwt-secret`,
        `MAIL_SMTP_HOST=${process.env.MAIL_SMTP_HOST ?? 'localhost'}`,
        `MAIL_SMTP_PORT=${process.env.MAIL_SMTP_PORT ?? '1025'}`,
        `MAIL_FROM_ADDRESS=noreply@interview-insights.local`,
      ].join('\n'),
    );

    // Deliberately not `{ ...process.env }`: the whole point is that
    // ADMIN_JWT_SECRET/DATABASE_URL/etc. must come from the .env file
    // alone, not from anything already sitting in this test's own
    // environment (which CI/local runs may well have exported).
    child = spawn('npx', ['ts-node', path.join(__dirname, '../src/main.ts')], {
      cwd: path.join(__dirname, '..'),
      env: { PATH: process.env.PATH, HOME: process.env.HOME, DOTENV_CONFIG_PATH: envPath },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    child.stdout?.on('data', (d: Buffer) => (output += d.toString()));
    child.stderr?.on('data', (d: Buffer) => (output += d.toString()));

    const exitedEarly = new Promise<string>((resolve) => {
      child?.once('exit', (code) => resolve(`process exited early with code ${code}:\n${output}`));
    });

    const healthy = async (): Promise<boolean> => {
      try {
        const res = await fetch(`http://localhost:${port}/health`);
        return res.ok;
      } catch {
        return false;
      }
    };

    const deadline = Date.now() + 20000;
    let ok = false;
    while (Date.now() < deadline) {
      if (await Promise.race([healthy(), exitedEarly.then(() => false)])) {
        ok = true;
        break;
      }
      if (child.exitCode !== null) break;
      await new Promise((r) => setTimeout(r, 250));
    }

    if (!ok && child.exitCode !== null) {
      throw new Error(await exitedEarly);
    }
    expect(ok).toBe(true);
  }, 30000);
});
