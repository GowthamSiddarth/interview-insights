# Secrets

Where every credential in this project actually lives, how it gets to a
running pod, and how to verify any of it. Read this before adding a new
secret or debugging why a pod can't reach one — it's the canonical
answer to "where does this value come from," so it should stay accurate
as the single source rather than reconstructed from scattered comments.

See CLAUDE.md's hard constraint #6 for the rule this document exists to
uphold: **no secret is ever committed as plaintext, not even a
placeholder.** `docs/DECISIONS.md` D20/D22/D23/D74/D76/D77 cover the
reasoning behind the two patterns below; GitHub issue #466 is where the
last plaintext holdouts were closed out.

## The two patterns, and which secrets use which

Every real credential in this project uses exactly one of two patterns.
There is no third option, and no exceptions beyond the one noted under
pattern B.

**Pattern A — fetched from LocalStack Secrets Manager at boot.** The
default. Used by anything a NestJS service (`api`,
`notification-service`) needs, because that service's own code can run
first and do the fetching before anything else needs the value.

**Pattern B — provisioned imperatively, never committed anywhere.** The
exception, used only when a credential is needed *before* any of this
project's own code exists to fetch one from Secrets Manager (Postgres's
own `initdb`), or predates this convention and hasn't been migrated yet
(admin/LocalStack/Anthropic credentials — explicitly out of scope for
#466, listed as future stretch work).

| Secret | Pattern | Consumed by | Env var(s) |
|---|---|---|---|
| `interview-insights/database-url` | A | `api`, `notification-service` | `DATABASE_URL` |
| `interview-insights/email-hash-secret` | A | `api` only | `EMAIL_HASH_SECRET` |
| `interview-insights/email-encryption-key` | A | `api`, `notification-service` | `EMAIL_ENCRYPTION_KEY` (D74: byte-identical across both — same Secrets Manager entry, by construction) |
| `interview-insights/candidate-jwt-secret` | A | `api` only | `CANDIDATE_JWT_SECRET` |
| `postgres-credentials` | B (D77) | Postgres's own container | `POSTGRES_PASSWORD` |
| `admin-credentials` | B (issue #192, pre-#466) | `api` | `ADMIN_PASSWORD_HASH`, `ADMIN_JWT_SECRET` |
| `localstack-credentials` | B (chicken-and-egg: needed to start LocalStack itself) | LocalStack's own pod | `LOCALSTACK_AUTH_TOKEN` |
| `anthropic-credentials` | B (issue #163, pre-#466, genuinely optional) | `api` | `ANTHROPIC_API_KEY` |

Nothing else in the deployed system is a secret. `POSTGRES_USER`/
`POSTGRES_DB` (`postgres-config` ConfigMap), `ADMIN_USERNAME`,
`ANTHROPIC_MODEL`, `AI_MODERATION_AUTO_APPROVE_THRESHOLD`,
`AI_AUTO_APPROVAL_ENABLED`, `CORS_ORIGIN`, `COOKIE_DOMAIN`,
`COOKIE_SECURE`, `PORT`, `OPENSEARCH_URL`, `MAIL_SMTP_HOST`,
`MAIL_SMTP_PORT`, `REDPANDA_BROKERS`, `SECRETS_SOURCE`,
`AWS_ENDPOINT_URL`, `AWS_REGION`, `AWS_SECRETS_ROLE_ARN` all live in
plain `ConfigMap`s (`api-config`, `notification-service-config`,
`postgres-config`) — not sensitive, safe to commit as-is.

## Pattern A in detail: LocalStack Secrets Manager

**Fetched by:** each service's own copy of a `localstack-secrets-bootstrap.ts`
module (`api/src/secrets/`, `services/notification-service/src/secrets/`
— deliberately duplicated, not shared, per D73/D75's precedent), called
at the top of `main.ts`'s `bootstrap()` before `NestFactory.create()`.
No-op unless `SECRETS_SOURCE=localstack` is set. **Throws on any
failure** — there is no fallback value, so a pod that's `Ready` proves
the fetch succeeded (see the verification section below for why this
matters more than it sounds).

**IAM roles, one per service, least-privilege:**

| Role | Policy | Can read |
|---|---|---|
| `api-secrets-role` | `infra/aws/api-secrets-access-policy.json` | all 4 Pattern-A secrets |
| `notification-service-secrets-role` | `infra/aws/notification-service-secrets-access-policy.json` | `database-url`, `email-encryption-key` only |

**Seeded in two places that must be kept in sync** (a real bug found
post-#466, see "Adding a new secret" below):
- `infra/aws/seed-localstack.sh` — runs *outside* the container (CD,
  `bootstrap-kind.sh`, or a human), creates both secrets and both
  IAM role/policy pairs. `SEED_*` env vars override the default seeded
  values (`SEED_DATABASE_URL`, `SEED_EMAIL_HASH_SECRET`,
  `SEED_EMAIL_ENCRYPTION_KEY`, `SEED_CANDIDATE_JWT_SECRET`).
  `DATABASE_URL`'s password comes from `$POSTGRES_PASSWORD` (D77) —
  keeping this in sync with the real Postgres password is why `cd.yml`'s
  "Seed LocalStack secrets + IAM" step explicitly passes it through.
- `infra/k8s/base/localstack/init/seed.sh` — LocalStack's own
  [lifecycle-hook](https://docs.localstack.cloud/user-guide/lifecycle-hooks/),
  mounted into the container, runs automatically on every LocalStack
  start including an *unplanned* restart (LocalStack has no PVC by
  design, D20 — its Secrets Manager/IAM state doesn't survive a restart
  otherwise). A functionally identical copy of the same seeding logic,
  because it runs inside the container with the bundled `awslocal`
  wrapper, not via the outside-facing AWS CLI the other script needs.

**Wired in:** `infra/k8s/overlays/dev/api-config-patch.yaml` and
`.../notification-service-config-patch.yaml` set `SECRETS_SOURCE`/
`AWS_ENDPOINT_URL`/`AWS_REGION`/`AWS_SECRETS_ROLE_ARN` on each service's
ConfigMap. `dev` requires this unconditionally (D76) — there is no
overlay left where these secrets come from anywhere else.

## Pattern B in detail: imperative provisioning

Created via `kubectl create secret generic ... --from-literal=...
--dry-run=client -o yaml | kubectl apply -f -`, sourced from a GitHub
Actions repo secret (CD) or a required local env var
(`bootstrap-kind.sh`, hard-fails if unset — no default, no fallback).
Never appears in any committed manifest. Must run before the overlay
apply that creates the consuming pod (`envFrom` doesn't hot-reload).

**GitHub Actions repo secrets** (`gh secret list`): `ADMIN_PASSWORD_HASH`,
`ADMIN_JWT_SECRET`, `LOCALSTACK_AUTH_TOKEN`, `POSTGRES_PASSWORD` — plus
optionally `ANTHROPIC_API_KEY` (its absence is expected, not a gap: AI
moderation triage is disabled by default).

## Verification tools

| Script | Checks | Requires |
|---|---|---|
| `infra/aws/verify-iam-policy.sh` | `api-secrets-access-policy.json` is syntactically valid and structurally least-privilege (no cluster needed) | LocalStack running standalone (docker-compose `localstack` profile) |
| `infra/aws/verify-secrets-manager.sh` | Full live-cluster check: exact secret inventory, both roles/policies, least-privilege scoping, `api`/`notification-service` pod health as proof the fetch succeeded, all 4 Pattern-B secrets exist | `kubectl` context on the real cluster, `aws` CLI |

`verify-secrets-manager.sh` deliberately does **not** try to read
`DATABASE_URL`/etc. via `kubectl exec ... -- printenv` — that spawns a
brand-new process which only sees the container's env as configured at
pod creation, not whatever the long-running app process later set on
its own in-memory `process.env` via the bootstrap module. Pod
readiness + 0 restarts + no `ResourceNotFoundException` in logs is the
actual externally-observable proof, since the bootstrap function has no
fallback to silently succeed with.

## Adding a new secret

1. **Does it need to exist before any of this project's own NestJS code
   could run?** (Postgres's own credential is the only current example.)
   If yes → Pattern B, imperative, same shape as `admin-credentials`.
   If no → Pattern A, LocalStack.
2. **For Pattern A:** add the secret ID + fetch + `process.env` write to
   the consuming service's `localstack-secrets-bootstrap.ts`; add its
   ARN to that service's own `*-secrets-access-policy.json` (only the
   services that actually need it — don't widen an existing role's
   policy as a shortcut); add seeding for it to **both**
   `infra/aws/seed-localstack.sh` **and**
   `infra/k8s/base/localstack/init/seed.sh` — missing the second one is
   an easy, real mistake (it happened once already) that only surfaces
   after an unplanned LocalStack restart, not immediately.
3. **For Pattern B:** add a provisioning step to **both** `cd.yml` and
   `infra/scripts/bootstrap-kind.sh`, hard-failing if the env var is
   unset; add the GitHub Actions repo secret
   (`gh secret set YOUR_NEW_SECRET`); document it in
   `wiki/deployment-guide.md`'s rotation sections (5b/5d are the
   existing examples).
4. Update the table at the top of this file.
5. Add a `docs/DECISIONS.md` entry if the choice between A and B wasn't
   obvious, same as D76/D77 did.
