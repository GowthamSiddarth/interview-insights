# Phase 11, Issue #80 — End-to-End Verification: Redeploy with LocalStack-Backed Secrets, Re-Run the Golden Path

*Part of Phase 11 — Integrated Prototype: LocalStack Secrets & IAM in
kind. See `docs/ROADMAP.md` Phase 11, `docs/DECISIONS.md` D22.*

This issue exists specifically to be harder to satisfy than issue #79's
own verification — and doing exactly that surfaced a real bug that
would otherwise have shipped silently.

## Why this came first

Issue #79's proof that `api` was really using LocalStack-sourced secrets
was genuine but narrower than it looked: it created a candidate through
the running API and confirmed the stored `email_hash` matched the
LocalStack-seeded secret, not the plaintext k8s Secret's value. That's a
real, falsifiable check — but it only exercises the *app's own runtime
queries*. This issue's whole purpose was to ask a more adversarial
question: what if the plaintext Secret's values were simply wrong? Would
anything in the boot sequence still quietly depend on them?

## Core concept: an adversarial test proves something a happy-path test can't

The distinction matters concretely here. A test that checks "does the
app work when everything is configured correctly" can pass for the wrong
reason — for instance, if two different code paths happen to read the
same *correct* value from two different sources, a happy-path test can't
tell those sources apart. Deliberately corrupting the plaintext
`api-secrets` k8s Secret with obviously-wrong values
(`postgresql://bogus-user:bogus-pass@nonexistent-host:5432/nope`,
`THIS-IS-A-DELIBERATELY-WRONG-VALUE`) and then checking whether the app
*still works correctly* removes that ambiguity entirely: if it does, the
correct value came from somewhere else; if it doesn't, something is
still reading the corrupted source.

## The bug this found: two processes, one container, only one bootstrap

Restarting `api` with the corrupted Secret in place produced a crash —
but the crash log revealed something more specific and more useful than
"it's broken":

```
Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "nope", schema "public" at "nonexistent-host:5432"

Error: P1001: Can't reach database server at `nonexistent-host:5432`
```

The migration step was using the *corrupted* value — even though
`main.ts`'s own `bootstrapSecretsFromLocalStack()` call, which issue #79
had already verified worked, should have overwritten `DATABASE_URL`
before anything used it. The reason is exact: `api/Dockerfile`'s `CMD`
was `sh -c "npx prisma migrate deploy && node dist/main.js"` — two
*separate* processes chained by a shell operator. `npx prisma migrate
deploy` reads `DATABASE_URL` straight from the container's OS
environment (set by `envFrom: secretRef: api-secrets`). It has no way to
observe `main.ts`'s in-process `process.env.DATABASE_URL = ...`
assignment, because that assignment happens inside a *different, later*
Node process — one that hadn't even started yet when `migrate deploy`
ran. Issue #79's verification never caught this because, at the time it
ran, the plaintext Secret's `DATABASE_URL` happened to already be
*correct* (pointing at the real Postgres) — so migrations trivially
succeeded either way, and the divergence between "migrations used the
k8s Secret" and "the app used LocalStack" was invisible until the two
values were deliberately made to disagree.

## System design approach: one bootstrap, inherited by both children

```javascript
// api/scripts/entrypoint.js
async function main() {
  const { bootstrapSecretsFromLocalStack } = require('../dist/secrets/localstack-secrets-bootstrap');
  await bootstrapSecretsFromLocalStack(); // mutates process.env, once, here

  const migrate = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: process.env, // the *current*, already-mutated env — not the original container env
  });
  if (migrate.status !== 0) process.exit(migrate.status ?? 1);

  require('../dist/main'); // main.ts's own bootstrap call becomes a harmless, idempotent re-fetch
}
```

The fix relies on a specific, easy-to-miss fact about `child_process` in
Node: `spawnSync`/`spawn` inherit the *current* `process.env` of the
process that calls them by default — not the environment the container
was originally started with. Once `bootstrapSecretsFromLocalStack()` has
mutated `process.env` inside `entrypoint.js`, every subsequent child
process (the migration) and the eventually-`require`'d app both see the
corrected values, because they're reading the same in-memory object, not
re-reading the OS environment independently. `main.ts` still calls the
same bootstrap function itself, which is now a harmless, idempotent
redundant fetch when `SECRETS_SOURCE=localstack` — kept deliberately so
`node dist/main.js` stays correct even if ever run without this
entrypoint wrapper (e.g. locally, outside a container).

This is also a genuine drop-in replacement, not a LocalStack-specific
branch: when `SECRETS_SOURCE` isn't set, `bootstrapSecretsFromLocalStack()`
no-ops immediately and the entrypoint behaves exactly like the old
`sh -c "... && ..."` CMD, just via `spawnSync`/`require` instead of a
shell operator.

## Step-by-step: what actually got built and verified

1. **Corrupted `api-secrets`** with obviously-wrong `DATABASE_URL`/
   `EMAIL_HASH_SECRET` values and restarted the deployment — confirmed
   the crash, then read the crash log carefully enough to see *which*
   host it was trying to reach, which pointed directly at the migration
   step rather than the app itself.
2. **Diagnosed the two-process boundary** by reading `api/Dockerfile`'s
   `CMD` and recognizing `&&` as a shell-level chain of two independent
   process invocations, neither of which shares in-process state with
   Node's `process.env` mutations happening inside the other.
3. **Wrote `api/scripts/entrypoint.js`** and updated the Dockerfile's
   `CMD` to use it, keeping the exact same migrate-then-start ordering
   but now sharing one bootstrapped environment across both steps.
4. **Hit an unrelated, genuinely separate problem while re-verifying**:
   the api pod crashed with `index_create_block_exception: ... blocked by:
   [FORBIDDEN/10/cluster create-index blocked (api)]` — traced to the
   `kind` node's Docker disk usage sitting at 91%, past OpenSearch's
   default high watermark, which puts indices into a forced read-only
   state. Freed space with `docker builder prune`/`docker image prune`
   (10.9GB of dangling images, 12.84GB of build cache — neither touching
   running containers or named volumes) and cleared the resulting
   `read_only_allow_delete` block directly via OpenSearch's settings
   API, rather than assuming it was a code regression from this issue's
   own changes.
5. **Re-ran the full adversarial test with the fix in place**: rebuilt
   and reloaded the `api` image, corrupted `api-secrets` again, restarted
   — and confirmed via the pod logs that Prisma's migration step now
   correctly logged `Datasource "db": ... at "postgres:5432"` (the real
   host), not the corrupted one. Created a candidate through the running
   API and confirmed the stored `email_hash` matched the LocalStack
   secret exactly, as issue #79 had already shown — now proven true for
   the *whole container's* boot sequence, not just the app process.
6. **Restored `api-secrets` to its correct values** before moving on,
   so the cluster wasn't left in a deliberately-broken state for future
   work.
7. **Re-ran the complete golden path** through the real,
   Helm-ingress-fronted `web` app with Playwright, capturing console
   errors throughout: create company → candidate/process → round →
   rating (confirmed `pending` directly in Postgres, per CLAUDE.md hard
   constraint #2) → moderation approve via the API → confirmed publicly
   visible via `GET /rounds/:roundId/ratings` → refreshed the Phase 4
   materialized views → analytics endpoint returned `sample_size: 1`
   with every score `null` (correctly below the shrinkage floor, per
   hard constraint #3 — the dashboard rendered "Not enough reviews yet"
   accordingly) → both company search and review search found the new
   company/review via OpenSearch. Zero console errors across every step.
8. **Documented the finding as D22** in `docs/DECISIONS.md` — including
   the honest, unchanged boundary from D20 that LocalStack's free tier
   still doesn't evaluate IAM policies, so this remains a local
   prototype, not a Phase 8 substitute.

## What this enabled

The adversarial-verification discipline this project has applied
throughout (confirm both a passing and a failing case; don't trust a
happy path alone) found a real bug here that a less skeptical check
would have missed entirely — and would have shipped, since the plaintext
Secret's value happened to be correct at the time issue #79 was
verified. The general lesson carries beyond this one bug: whenever a new
code path is *supposed* to replace an old one, the strongest available
proof isn't "the new path works" — it's "the old path's inputs can be
wrong and the system still works," because only that rules out the old
path silently still being load-bearing.
