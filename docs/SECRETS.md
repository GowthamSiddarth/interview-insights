# Secrets

Where every credential in this project actually lives, how it gets to a
running pod, and how to verify any of it. Read this before adding a new
secret or debugging why a pod can't reach one — it's the canonical
answer to "where does this value come from," so it should stay accurate
as the single source rather than reconstructed from scattered comments.

See CLAUDE.md's hard constraint #6 for the rule this document exists to
uphold: **no secret is ever committed as plaintext, not even a
placeholder.** `docs/DECISIONS.md` D20/D22/D23/D74/D76/D77/D78 cover the
reasoning behind the two patterns below; GitHub issue #466 and its own
follow-up (D78) are where the plaintext holdouts, and then the
remaining imperative-only secrets, were closed out.

## The two patterns, and which secrets use which

Every real credential in this project uses exactly one of two patterns
— plus one hybrid case, which is really still Pattern B underneath, just
also feeding Pattern A. There is no third *independent* pattern.

**Pattern A — fetched from LocalStack Secrets Manager at boot.** The
default for anything a NestJS service (`api`, `notification-service`,
`review-analyzer`) needs, because that service's own code can run first
and do the fetching before anything else needs the value.

**Pattern B — provisioned imperatively, never committed anywhere.** Used
only when a credential is needed *before* any of this project's own code
exists to fetch one from Secrets Manager. Two genuinely permanent cases
(D78 closed the question of whether there were more): Postgres's own
`initdb` (D77), and the token needed to start LocalStack itself before
anything could fetch from it.

**Pattern A, hybrid root (D78):** `admin-credentials`/
`anthropic-credentials` are Pattern B *and* feed Pattern A — provisioned
imperatively exactly like the pure-B secrets, but also wired into
LocalStack's own pod so its init-hook can seed Secrets Manager with the
real value on every start. `api` only ever talks to Secrets Manager for
`admin-credentials`; `anthropic-api-key` moved to `review-analyzer` as of
GitHub issue #340 (D81) — see the dedicated section below for why the
hybrid shape exists and isn't just Pattern A.

| Secret | Pattern | Consumed by | Env var(s) |
|---|---|---|---|
| `interview-insights/database-url` | A | `api`, `notification-service`, `review-analyzer` | `DATABASE_URL` |
| `interview-insights/email-hash-secret` | A | `api` only | `EMAIL_HASH_SECRET` |
| `interview-insights/email-encryption-key` | A | `api`, `notification-service` | `EMAIL_ENCRYPTION_KEY` (D74: byte-identical across both — same Secrets Manager entry, by construction) |
| `interview-insights/candidate-jwt-secret` | A | `api` only | `CANDIDATE_JWT_SECRET` |
| `interview-insights/admin-password-hash` | A, hybrid root (D78) | `api` | `ADMIN_PASSWORD_HASH` |
| `interview-insights/admin-jwt-secret` | A, hybrid root (D78) | `api` | `ADMIN_JWT_SECRET` |
| `interview-insights/anthropic-api-key` | A, hybrid root (D78) | `review-analyzer` (moved from `api` by GitHub issue #340/D81) | `ANTHROPIC_API_KEY` — genuinely optional; the *secret* is absent (not present-and-empty) when not configured |
| `postgres-credentials` (k8s Secret) | B (D77) | Postgres's own container | `POSTGRES_PASSWORD` |
| `admin-credentials` (k8s Secret) | B, root for the hybrid case above (issue #192) | LocalStack's own pod (D78) — no longer `api` directly | `ADMIN_PASSWORD_HASH`, `ADMIN_JWT_SECRET` |
| `localstack-credentials` (k8s Secret) | B (chicken-and-egg: needed to start LocalStack itself) | LocalStack's own pod | `LOCALSTACK_AUTH_TOKEN` |
| `anthropic-credentials` (k8s Secret) | B, root for the hybrid case above (issue #163) | LocalStack's own pod (D78) — never `api`/`review-analyzer` directly | `ANTHROPIC_API_KEY` |

Nothing else in the deployed system is a secret. `POSTGRES_USER`/
`POSTGRES_DB` (`postgres-config` ConfigMap), `ADMIN_USERNAME`,
`ANTHROPIC_MODEL`, `AI_MODERATION_AUTO_APPROVE_THRESHOLD`,
`AI_AUTO_APPROVAL_ENABLED` (moved to `review-analyzer-config` by GitHub
issue #340/D81), `CORS_ORIGIN`, `COOKIE_DOMAIN`, `COOKIE_SECURE`, `PORT`,
`OPENSEARCH_URL`, `MAIL_SMTP_HOST`, `MAIL_SMTP_PORT`, `REDPANDA_BROKERS`,
`SECRETS_SOURCE`, `AWS_ENDPOINT_URL`, `AWS_REGION`,
`AWS_SECRETS_ROLE_ARN` all live in plain `ConfigMap`s (`api-config`,
`notification-service-config`, `review-analyzer-config`,
`postgres-config`) — not sensitive, safe to commit as-is.

## Pattern A in detail: LocalStack Secrets Manager

**Fetched by:** each service's own copy of a `localstack-secrets-bootstrap.ts`
module (`api/src/secrets/`, `services/notification-service/src/secrets/`,
`services/review-analyzer/src/secrets/` — deliberately duplicated, not
shared, per D73/D75's precedent), called at the top of `main.ts`'s
`bootstrap()` before `NestFactory.create()`. No-op unless
`SECRETS_SOURCE=localstack` is set. **Throws on any failure** — there is
no fallback value, so a pod that's `Ready` proves the fetch succeeded
(see the verification section below for why this matters more than it
sounds).

**IAM roles, one per service, least-privilege:**

| Role | Policy | Can read |
|---|---|---|
| `api-secrets-role` | `infra/aws/api-secrets-access-policy.json` | 6 Pattern-A secrets (`database-url` through `admin-jwt-secret`; `anthropic-api-key` moved off this role by GitHub issue #340/D81) |
| `notification-service-secrets-role` | `infra/aws/notification-service-secrets-access-policy.json` | `database-url`, `email-encryption-key` only |
| `review-analyzer-secrets-role` | `infra/aws/review-analyzer-secrets-access-policy.json` | `database-url`, `anthropic-api-key` only (GitHub issue #340/D81) |

**Seeded in two places that must be kept in sync** (a real bug found
post-#466, see "Adding a new secret" below):
- `infra/aws/seed-localstack.sh` — runs *outside* the container (CD,
  `bootstrap-kind.sh`, or a human), creates all 7 secrets and all three
  IAM role/policy pairs. `SEED_*` env vars override the default seeded
  values for the four plain ones (`SEED_DATABASE_URL`,
  `SEED_EMAIL_HASH_SECRET`, `SEED_EMAIL_ENCRYPTION_KEY`,
  `SEED_CANDIDATE_JWT_SECRET`). `DATABASE_URL`'s password comes from
  `$POSTGRES_PASSWORD` (D77) — keeping this in sync with the real
  Postgres password is why `cd.yml`'s "Seed LocalStack secrets + IAM"
  step explicitly passes it through. The three hybrid-root secrets have
  **no** `SEED_*` override and no default — they read
  `$ADMIN_PASSWORD_HASH`/`$ADMIN_JWT_SECRET` (required, hard-fails if
  unset) and `$ANTHROPIC_API_KEY` (optional — skips creating the secret
  entirely rather than seeding an empty one, see the gotcha below)
  directly, matching `bootstrap-kind.sh`'s own required-env-var checks
  for these specifically.
- `infra/k8s/base/localstack/init/seed.sh` — LocalStack's own
  [lifecycle-hook](https://docs.localstack.cloud/user-guide/lifecycle-hooks/),
  mounted into the container, runs automatically on every LocalStack
  start including an *unplanned* restart (LocalStack has no PVC by
  design, D20 — its Secrets Manager/IAM state doesn't survive a restart
  otherwise). A functionally identical copy of the same seeding logic
  for the four plain secrets (hardcoded dev-only values, since it runs
  inside the container with the bundled `awslocal` wrapper, not via the
  outside-facing AWS CLI the other script needs) — but for the three
  hybrid-root secrets, it reads them from **its own container
  environment** instead of a hardcoded value (see below for why).

**Wired in:** `infra/k8s/overlays/dev/api-config-patch.yaml`,
`.../notification-service-config-patch.yaml`, and (GitHub issue #340/D81)
`.../review-analyzer-config-patch.yaml` set `SECRETS_SOURCE`/
`AWS_ENDPOINT_URL`/`AWS_REGION`/`AWS_SECRETS_ROLE_ARN` on each service's
ConfigMap. `dev` requires this unconditionally (D76) — there is no
overlay left where these secrets come from anywhere else.

## The hybrid case: how `admin-credentials`/`anthropic-credentials` feed Pattern A (D78)

`ADMIN_PASSWORD_HASH`/`ADMIN_JWT_SECRET` never have a committed
placeholder value, by this project's own explicit intent (issue #192) —
unlike, say, `EMAIL_HASH_SECRET`, whose committed dev-only value the
init-hook can always fall back to. That creates a real problem for
migrating them to LocalStack naively: an unplanned LocalStack restart
wipes its Secrets Manager state, and the init-hook would have nothing
real to reseed these two with, making the admin login newly, silently
dependent on LocalStack's notoriously non-durable state (it has no PVC
by design, D20) — a regression from today, where `admin-credentials` is
just an ordinary k8s Secret with zero dependency on LocalStack.

The fix: `infra/k8s/base/localstack/08-localstack.yaml`'s Deployment
gets targeted `env.valueFrom.secretKeyRef` entries for
`admin-credentials`/`anthropic-credentials` — the *exact* mechanism it
already uses for its own `localstack-credentials`/`LOCALSTACK_AUTH_TOKEN`.
The init-hook then reads `$ADMIN_PASSWORD_HASH`/`$ADMIN_JWT_SECRET`/
`$ANTHROPIC_API_KEY` from its own now-populated environment and seeds
Secrets Manager with those **real** values on every start — genuine
self-healing, not a placeholder. `admin-credentials`/
`anthropic-credentials` themselves are untouched: still provisioned
imperatively, exactly as before, in `cd.yml`/`bootstrap-kind.sh`. The
only thing that changed (D78) is who reads them from Secrets Manager —
LocalStack's pod feeds the seeded value in, and (as of GitHub issue
#340/D81) `review-analyzer` is now the one that fetches
`anthropic-api-key` back out via its own role, not `api` — `api` still
fetches `admin-password-hash`/`admin-jwt-secret`.

**Why this is worth the extra indirection instead of just leaving
`admin-credentials`/`anthropic-credentials` on Pattern B forever:**
one canonical fetch path for every secret `api` reads, and the init-hook
can genuinely self-heal these two now, closing a durability gap that
would otherwise only get discovered the hard way (the same way the
seeding-script-drift bug from #466 itself was found — see this file's
"Adding a new secret" section).

**Accepted tradeoff:** the real admin credential now also transits
through LocalStack's own container environment, not just `api`'s. Not a
new *kind* of exposure — `LOCALSTACK_AUTH_TOKEN` already works
identically — just one more place the value exists, acceptable at this
project's current all-local-dev, Phase-8b-gated scope. If that scope
ever changes, revisit alongside D78's own "Revisit when."

**Gotcha found in production (well, the local cluster) within hours of
merging this: never seed a Secrets Manager entry with an empty string.**
`ANTHROPIC_API_KEY` being genuinely optional made seeding it as `""`
when unset seem like the obvious move — it isn't. AWS Secrets Manager's
`CreateSecret` requires `SecretString` to be at least 1 character; an
empty string is rejected outright. Both seeding scripts run under
`set -e`, so that one failed `create-secret` call silently aborted the
rest of the script *before it ever reached IAM role provisioning* —
`api-secrets-role`/`notification-service-secrets-role` went
unprovisioned on that run, with no error surfaced anywhere except
`verify-secrets-manager.sh` catching it after the fact. The fix: "not
configured" means the Secrets Manager entry **doesn't exist**, not that
it exists with an empty value — both seeding scripts skip creating
`interview-insights/anthropic-api-key` when no real key is set, and
`fetchOptionalSecret()` catches `ResourceNotFoundException` specifically
to mean "disabled," re-throwing anything else. If a future optional
secret needs this same treatment, skip-creating-when-absent is the
correct pattern — an empty-string sentinel will fail the exact same way.

## Pattern B in detail: imperative provisioning

Created via `kubectl create secret generic ... --from-literal=...
--dry-run=client -o yaml | kubectl apply -f -`, sourced from a GitHub
Actions repo secret (CD) or a required local env var
(`bootstrap-kind.sh`, hard-fails if unset — no default, no fallback).
Never appears in any committed manifest. Must run before the overlay
apply that creates the consuming pod (`envFrom`/`env.valueFrom` doesn't
hot-reload) — this now includes LocalStack's own pod for
`admin-credentials`/`anthropic-credentials` (D78), same ordering
requirement `cd.yml`/`bootstrap-kind.sh` already had for them.

**GitHub Actions repo secrets** (`gh secret list`): `ADMIN_PASSWORD_HASH`,
`ADMIN_JWT_SECRET`, `LOCALSTACK_AUTH_TOKEN`, `POSTGRES_PASSWORD` — plus
optionally `ANTHROPIC_API_KEY` (its absence is expected, not a gap: AI
moderation triage is disabled by default). Unchanged by D78 — the same
four repo secrets (plus the one optional one) still source the same
k8s Secrets; only the *consumer* of `admin-credentials`/
`anthropic-credentials` changed, from `api` directly to LocalStack's
own pod. GitHub issue #340/D81 changed one more hop downstream of that:
which service's IAM role reads `anthropic-api-key` back out of Secrets
Manager (`review-analyzer` now, not `api`) — the repo secret and the k8s
Secret it provisions are unaffected.

### Hazard: rotating a repo secret while CD may be in flight

GitHub issue #568: `postgres-credentials`'s `POSTGRES_PASSWORD` key was
found empty (0 bytes) twice in one day. Root cause was a race, not a
one-off — CD's "Provision Postgres credentials secret" step resolves
`${{ secrets.POSTGRES_PASSWORD }}` when *that step* runs, not when the
job was queued (this repo's self-hosted runner can sit on a queued job
for hours, per the intro comment above). A `gh secret set
POSTGRES_PASSWORD` landing while that expression is being resolved can
observe an empty value instead of either the old or new one — CD then
happily writes that empty value into the live `postgres-credentials`
Secret, silently breaking Postgres auth for every consumer
(`api`/`notification-service`/`review-analyzer`) until something forces
those pods to reconnect.

The provisioning step now hard-fails instead of applying an empty
value (see `cd.yml`'s "Provision Postgres credentials secret" step) —
but the underlying race is still real. Before hand-rotating
`POSTGRES_PASSWORD` (or any Pattern B repo secret) via `gh secret set`,
check for an in-flight or queued CD run first
(`gh run list --workflow CD`) and avoid rotating while one exists.

## Verification tools

| Script | Checks | Requires |
|---|---|---|
| `infra/aws/verify-iam-policy.sh` | `api-secrets-access-policy.json` is syntactically valid and structurally least-privilege (no cluster needed) | LocalStack running standalone (docker-compose `localstack` profile) |
| `infra/aws/verify-secrets-manager.sh` | Full live-cluster check: exact 6-always-required-secret inventory (`anthropic-api-key` checked separately, informationally), all three roles/policies and their exact scoping, `api`/`notification-service`/`review-analyzer` pod health as proof every fetch succeeded, all 4 Pattern-B secrets exist, and (D78) LocalStack's own pod is healthy with the hybrid-root `env` entries wired in | `kubectl` context on the real cluster, `aws` CLI |

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
   If yes → Pattern B, imperative, same shape as `postgres-credentials`.
   If no → Pattern A, LocalStack, same shape as most of the table above.
2. **For Pattern A:** add the secret ID + fetch + `process.env` write to
   the consuming service's `localstack-secrets-bootstrap.ts` (use
   `fetchSecret` unless the value can legitimately be "not configured,"
   in which case `fetchOptionalSecret`, D78 — and make the seeding
   scripts skip *creating* that secret when unset, never seed it as an
   empty string; Secrets Manager rejects that outright, see the gotcha
   above); add its ARN to that service's own
   `*-secrets-access-policy.json` (only the services that actually need
   it — don't widen an existing role's policy as a shortcut); add
   seeding for it to **both** `infra/aws/seed-localstack.sh` **and**
   `infra/k8s/base/localstack/init/seed.sh` — missing the second one is
   an easy, real mistake (it happened once already) that only surfaces
   after an unplanned LocalStack restart, not immediately.
3. **For Pattern B:** add a provisioning step to **both** `cd.yml` and
   `infra/scripts/bootstrap-kind.sh`, hard-failing if the env var is
   unset; add the GitHub Actions repo secret
   (`gh secret set YOUR_NEW_SECRET`); document it in
   `wiki/deployment-guide.md`'s rotation sections (5b/5d are the
   existing examples).
4. **Only reach for the hybrid case (D78)** if a Pattern-B secret is
   both (a) never allowed a committed placeholder and (b) worth
   migrating to Secrets Manager anyway — check whether the durability
   tradeoff (LocalStack's restart fragility) actually matters for that
   specific credential before doing the extra `env.valueFrom.secretKeyRef`
   wiring into LocalStack's own pod. Most new secrets should be pure
   Pattern A or pure Pattern B; the hybrid case exists because
   `admin-credentials`/`anthropic-credentials` specifically needed both
   properties at once, not as a general-purpose third option.
5. Update the table at the top of this file.
6. Add a `docs/DECISIONS.md` entry if the choice wasn't obvious, same
   as D76/D77/D78 did.
