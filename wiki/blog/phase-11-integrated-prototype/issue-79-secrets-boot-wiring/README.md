# Phase 11, Issue #79 — Wire api's Boot Path to Fetch Real Secrets via an Assumed IAM Role

*Part of Phase 11 — Integrated Prototype: LocalStack Secrets & IAM in
kind. See `docs/ROADMAP.md` Phase 11, `docs/DECISIONS.md` D20/D22.*

## Why this came first

Issue #78 got LocalStack running inside the `kind` cluster, reachable
from `api`'s pod — but reachable isn't the same as used. Phase 10's
`SecretsModule` had a real, tested `SecretsProvider`, but grepping the
codebase confirmed the honest state: `AppModule` never imported it.
`api` still read `DATABASE_URL`/`EMAIL_HASH_SECRET` from plain
environment variables in every environment that actually ran. This issue
closes that specific gap — making the secrets-fetching code path the one
that's actually live, not just unit-tested in isolation.

## Key concept: process.env has to be mutated before the thing that reads it exists, not before it's used

`PrismaService` (`api/src/prisma/prisma.service.ts`) `extends
PrismaClient` — meaning `super()` runs, and Prisma captures
`env("DATABASE_URL")`, the moment Nest constructs the service as part of
wiring up `AppModule`'s dependency graph. That construction happens
inside `NestFactory.create(AppModule)`. The consequence is exact and
easy to get subtly wrong: a secrets-fetch that runs *after*
`NestFactory.create()` — even by one line, even "at the top of
`onModuleInit`" — is already too late, because the module tree,
including `PrismaService`'s own `PrismaClient` instance with whatever
`DATABASE_URL` was in `process.env` at that instant, has already been
built. `bootstrapSecretsFromLocalStack()` therefore has to run as the
literal first line of `main.ts`'s `bootstrap()` function, strictly
before `NestFactory.create` is ever called — not "early," but *first*.

## System design approach

```typescript
// api/src/secrets/localstack-secrets-bootstrap.ts
export async function bootstrapSecretsFromLocalStack(): Promise<void> {
  if (process.env.SECRETS_SOURCE !== 'localstack') {
    return; // every other environment: completely unchanged
  }

  const roleArn = process.env.AWS_SECRETS_ROLE_ARN;
  if (!roleArn) {
    throw new Error('AWS_SECRETS_ROLE_ARN must be set when SECRETS_SOURCE=localstack.');
  }

  const sts = new STSClient(localstackAwsClientConfig());
  const assumed = await sts.send(
    new AssumeRoleCommand({ RoleArn: roleArn, RoleSessionName: 'api-boot' }),
  );
  // ... construct a SecretsManagerClient with the *temporary* credentials
  // AssumeRole returned, fetch both secrets, and only then:
  process.env.DATABASE_URL = databaseUrl;
  process.env.EMAIL_HASH_SECRET = emailHashSecret;
}
```

```typescript
// api/src/main.ts
async function bootstrap() {
  await bootstrapSecretsFromLocalStack(); // must be first — see above
  const app = await NestFactory.create(AppModule);
  // ...
}
```

Two design choices worth naming explicitly:

**Opt-in via a single env var, checked first, with an immediate return.**
`SECRETS_SOURCE !== 'localstack'` is the *only* condition gating this
entire function, checked before anything else runs. `docker-compose` and
the plain `dev` overlay never set this variable, so the function is a
true no-op there — zero behavior change, confirmed by the fact that
issue #78's `kubectl kustomize` diffs already proved the variable itself
never reaches those paths.

**Fail loudly, not gracefully.** This is a deliberate departure from D16
(company search indexing, best-effort, swallows failures) and D13
(fraud checks, never block a write). Both of those decisions apply to
*derived, secondary* data where a failure is recoverable and shouldn't
block a primary action. `DATABASE_URL` is not derived or secondary — a
silent fallback to nothing, or to a stale cached value, would mean the
app either can't function or is quietly misconfigured in a way that's
hard to notice. Throwing on any failure in the opted-in path — a missing
role ARN, a failed `AssumeRole`, a secret with no `SecretString` — means
a broken secrets configuration fails at boot, loudly, instead of
surfacing later as a confusing runtime error.

## A small refactor worth naming: extracting what two things already had in common

`secretsManagerClientProvider` (the existing Nest DI provider from Phase
10) and the new bootstrap function both needed the identical "LocalStack
needs dummy static credentials, real AWS needs the default SDK
credential chain" logic. Rather than duplicating it, that logic moved
into `aws-client-config.util.ts`, used by both call sites. This is the
same pattern D17 already established for
`opensearch-errors.util.ts` (extracting shared "swallow
`resource_already_exists_exception`" logic once two services needed it)
— duplication becomes worth removing exactly when a second, genuinely
independent caller appears, not before.

## Step-by-step: what actually got built

1. **Confirmed the exact construction-time dependency**: read
   `prisma.service.ts`, confirmed it `extends PrismaClient` (meaning
   `DATABASE_URL` is captured at construction, not lazily on first
   query), and confirmed `EMAIL_HASH_SECRET` is read lazily instead
   (`process.env.EMAIL_HASH_SECRET` inside a function called per-request
   in `candidates.service.ts`) — establishing that only `DATABASE_URL`
   has a hard "before `NestFactory.create`" requirement, while
   `EMAIL_HASH_SECRET` would technically tolerate being set later, but
   is set at the same point anyway for one consistent story.
2. **Added `@aws-sdk/client-sts`** and wrote
   `bootstrapSecretsFromLocalStack()`, extracting the shared client-config
   helper along the way.
3. **Wrote 5 unit tests** (mocked STS + Secrets Manager clients): the
   no-op path, a missing role ARN, the full happy path, `AssumeRole`
   returning no usable credentials, and a secret with no `SecretString`
   — the same defensive shape `SecretsProvider`'s own Phase 10 tests
   already used for the last case.
4. **Added a Kustomize patch** (`api-config-patch.yaml`) so only the
   `dev-localstack` overlay sets `SECRETS_SOURCE`/`AWS_ENDPOINT_URL`/
   `AWS_REGION`/`AWS_SECRETS_ROLE_ARN`, confirmed via `kubectl kustomize`
   diffs against both `base` and the plain `dev` overlay to prove neither
   is affected.
5. **Verified live, not just unit-tested**: rebuilt and reloaded the
   `api` image, applied the overlay, restarted the deployment, then
   created a real candidate through the running API and directly queried
   Postgres for the resulting `email_hash`. Computed the expected HMAC
   for that same email under *both* candidate secrets (the plaintext
   k8s Secret's `dev-only-change-me`, and the LocalStack-seeded
   `localstack-seeded-secret-change-me`) and confirmed the stored hash
   matched only the LocalStack one — a concrete, falsifiable proof that
   the assumed-role path is what's actually live, since `email_hash` is
   never returned by any API response (per CLAUDE.md hard constraint #1)
   and can only be checked this way.

## What this enabled

`api` can now genuinely boot end to end using secrets fetched from
LocalStack via an assumed IAM role — the first time either #78's
in-cluster LocalStack or Phase 10's `SecretsProvider` integration code
has been exercised by an actual running request path, not just a test.
This issue's own verification technique — comparing a stored value
against multiple candidate secrets to determine which one was actually
used — turned out to have a real limit, though: it only checked the
app's own runtime behavior, not the container's full boot sequence. That
gap is exactly what issue #80 found next.
