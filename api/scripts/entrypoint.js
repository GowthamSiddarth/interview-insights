#!/usr/bin/env node
// Container entrypoint (GitHub issue #80, Phase 11) — replaces the old
// `sh -c "npx prisma migrate deploy && node dist/main.js"` CMD.
//
// Found while doing this issue's adversarial verification (corrupting the
// plaintext api-secrets k8s Secret to prove api doesn't silently still
// depend on it): `npx prisma migrate deploy` is its own child process
// that reads DATABASE_URL straight from the OS environment — it has no
// way to see main.ts's in-process bootstrapSecretsFromLocalStack()
// mutating process.env, because that mutation happened in a *different*
// process that hadn't even started yet. Migrations were silently still
// keyed off the plaintext Secret's value the whole time; only the app's
// own runtime queries (via main.ts's own call to the same bootstrap
// function) were actually using the LocalStack-fetched value.
//
// Fix: run the bootstrap exactly once, here, before spawning anything —
// Node's child_process functions inherit the *current* process.env by
// default, not the original container env, so setting
// process.env.DATABASE_URL/EMAIL_HASH_SECRET here makes both the
// migration step and the app process see the same (correct) values.
// main.ts still calls the same bootstrap function itself (a no-op
// re-fetch when SECRETS_SOURCE isn't set; a harmless redundant fetch
// when it is) — kept so `node dist/main.js` stays correct on its own if
// ever run without this entrypoint.
const { spawnSync } = require('child_process');
const path = require('path');

async function main() {
  const { bootstrapSecretsFromLocalStack } = require(
    path.join(__dirname, '..', 'dist', 'secrets', 'localstack-secrets-bootstrap'),
  );
  await bootstrapSecretsFromLocalStack();

  const migrate = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: process.env,
  });
  if (migrate.status !== 0) {
    process.exit(migrate.status ?? 1);
  }

  require(path.join(__dirname, '..', 'dist', 'main'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
