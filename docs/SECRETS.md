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

## Hetzner pilot (Phase 45/46): a third environment, every secret is Pattern B

Scope: `overlays/hetzner-pilot` only. Does not change the Pattern-A
default for `dev`/`staging`/`prod` above — see D102 for the full
reasoning (LocalStack is dev-only by design, D20/D22/D23; real AWS
Secrets Manager would blur D101's boundary against D11 for one pilot
VM; a hosted secrets service adds a vendor relationship this
single-box pilot doesn't need).

**Sourcing changed by D105 (Phase 46, #708):** D102 originally sourced
every value below manually, from the operator's own password manager,
specifically because no CD workflow reached this environment yet.
`cd-hetzner.yml` (#708) changes that — it is a real CD workflow that
reaches this environment, the same way `cd.yml` already reaches the
local `kind` cluster. Once #708 ships, every Secret below is provisioned
*by that workflow*, not by hand — see D105 for the full reasoning and
the accepted blast-radius tradeoff. Until #708 ships, the manual
provisioning this section originally described is still how these get
created.

| Secret (k8s Secret name) | Pattern | Consumed by | Env var(s) | Sourced from (GitHub Actions repo secret, post-#708) |
|---|---|---|---|---|
| `postgres-credentials` | B (D77/D105) | Postgres's own container | `POSTGRES_PASSWORD` | `HETZNER_POSTGRES_PASSWORD` |
| `api-secrets` | B (D105) | `api` | `DATABASE_URL`, `EMAIL_HASH_SECRET`, `EMAIL_ENCRYPTION_KEY`, `CANDIDATE_JWT_SECRET`, `ADMIN_PASSWORD_HASH`, `ADMIN_JWT_SECRET`, `MAIL_SMTP_PASSWORD` (new — #655) | `HETZNER_DATABASE_URL`, `HETZNER_EMAIL_HASH_SECRET`, `HETZNER_EMAIL_ENCRYPTION_KEY`, `HETZNER_CANDIDATE_JWT_SECRET`, `HETZNER_ADMIN_PASSWORD_HASH`, `HETZNER_ADMIN_JWT_SECRET`, `HETZNER_MAIL_SMTP_PASSWORD` |
| `notification-service-secrets` | B (D105) | `notification-service` | `DATABASE_URL`, `EMAIL_ENCRYPTION_KEY`, `MAIL_SMTP_PASSWORD` (new — #655) | (same `HETZNER_DATABASE_URL`/`HETZNER_EMAIL_ENCRYPTION_KEY`/`HETZNER_MAIL_SMTP_PASSWORD` as above) |
| `review-analyzer-secrets` | B (D105) | `review-analyzer` | `DATABASE_URL`, `ANTHROPIC_API_KEY` (optional — omit `--from-literal` for it entirely when not configured, same "absent, not empty" rule as the gotcha below) | `HETZNER_DATABASE_URL`, `HETZNER_ANTHROPIC_API_KEY` (optional) |
| `ghcr-pull-secret` | B (D105, new — #660) | k3s node, via each Deployment's `imagePullSecrets` | n/a — a `kubernetes.io/dockerconfigjson`, not a literal env var | `HETZNER_GHCR_PAT` (also used directly by the self-hosted runner for `docker login ghcr.io` on the push side) |

Same 7 logical values as the Pattern-A table above (`anthropic-api-key`
included), plus the new GHCR pull secret #660 introduces and the new
`MAIL_SMTP_PASSWORD` #655 introduces — distributed across five k8s
Secrets instead of via Secrets Manager, grouped by consuming service
instead of one entry per value, since there's no per-secret IAM role to
scope here.

**`MAIL_SMTP_USER` is deliberately not in this table** — it's the
Brevo account login (an email address), not a credential, same
non-secret status this repo already gives `POSTGRES_USER`/
`POSTGRES_DB` (`infra/k8s/base/01-postgres-config.yaml`'s own comment).
It belongs in `overlays/hetzner-pilot`'s ConfigMap patch (#646's job),
not a Secret. `MAIL_SMTP_PASSWORD` (the actual Brevo SMTP key) is the
one real credential and follows the same Pattern B path as everything
else here.

**`DATABASE_URL` must be built by hand from the same
`POSTGRES_PASSWORD`** used for `postgres-credentials`, percent-encoded
exactly like `seed-localstack.sh` already does (D92) — construct it
once, then store the same literal string as the `HETZNER_DATABASE_URL`
repo secret consumed by both `api-secrets` and
`notification-service-secrets`/`review-analyzer-secrets`. There is no
seeding script doing this automatically here; get it wrong and Postgres
auth fails silently until someone checks pod logs.

**Wired in:** `overlays/hetzner-pilot`'s Deployment patches add
`envFrom: - secretRef: name: <service>-secrets` alongside the existing
`configMapRef` (#646's job, not this issue's), plus `imagePullSecrets:
- name: ghcr-pull-secret` (#660/#708's job). Its ConfigMap patch does
**not** set `SECRETS_SOURCE=localstack` — left unset, so
`bootstrapSecretsFromLocalStack()` stays a no-op and every service
reads these as plain env vars, the same fallback path docker-compose
already exercises.

**Provisioning order:** all five Secrets above must exist before
`kubectl apply -k overlays/hetzner-pilot` — same ordering requirement
Pattern B always has (`envFrom`/`imagePullSecrets` don't hot-reload).
`cd-hetzner.yml` (#708) is responsible for this ordering, same as
`cd.yml` already is for the kind cluster's own Pattern B secrets.

**Verification:** no automated equivalent of `verify-secrets-manager.sh`
exists for this environment yet (that script is LocalStack/IAM
specific, and there's no Secrets-Manager-side state to check here) —
pod readiness + 0 restarts is the same externally-observable proof
used elsewhere. A pilot-specific verify script, if one turns out to be
worth writing, belongs to #648 (deploy/verify), not this issue.

### `CLOUDFLARE_API_TOKEN` — a provisioning credential, not an app secret

GitHub issue #658 (Phase 46) — the pilot's domain (`interviewinsights.fyi`)
is registered on Cloudflare, which is also its DNS provider. A GitHub
Actions repo secret (`CLOUDFLARE_API_TOKEN`, scoped to just this zone via
Cloudflare's "Edit zone DNS" token template) manages the `app.`/`api.`
A records pointing at the pilot VM's IP. This isn't a Pattern A/B app
secret like everything else in this doc — no pod ever reads it, it's a
provisioning-time credential in the same category as `HCLOUD_TOKEN`
(`infra/terraform/hetzner/README.md`) — kept as a GitHub Actions secret
rather than purely an operator-local env var, unlike `HCLOUD_TOKEN`,
specifically so DNS can be re-synced (via a script, run by the operator —
no workflow consumes it automatically yet) if the pilot VM is ever
recreated and gets a new IP, which has already happened once during this
phase's own work.

### `HETZNER_SSH_PRIVATE_KEY` — CI's access credential to the pilot's SSH bastion

GitHub issue #214 epic (ad-hoc follow-up, Phase 46) — the pilot's k3s
API server (port 6443) is deliberately not opened in the Cloud Firewall
(#659); the only way to reach it is SSH as the `deploy` user (#668).
`cd-hetzner.yml`'s `deploy` job used to run on the project's one
self-hosted Mac specifically because that machine held
`~/.ssh/hetzner-vm`, the private key for that user — the *only* reason
that job needed a specific, persistent machine rather than a GitHub-hosted
one, once image builds moved off it too (see `build-images` above). This
secret is the same key's contents, uploaded so the `deploy` job can open
its own SSH tunnel from an ephemeral `ubuntu-latest` runner instead.

Not a Pattern A/B app secret — no pod ever reads it, same
provisioning-time-credential category as `CLOUDFLARE_API_TOKEN`/
`HCLOUD_TOKEN` above. Unlike those two, this one *is* a direct-access
credential to the live cluster (equivalent to `deploy`-user SSH access
to the VM itself), not a scoped API token — treat rotation and exposure
here with the same seriousness as `HETZNER_ADMIN_JWT_SECRET`/
`HETZNER_ADMIN_PASSWORD_HASH`, not as casually as a DNS-only token.

**Provisioning (one-time, manual — same "can't be provisioned by the
workflow itself" pattern as `LOCALSTACK_AUTH_TOKEN`):**
```bash
gh secret set HETZNER_SSH_PRIVATE_KEY --repo GowthamSiddarth/interview-insights < ~/.ssh/hetzner-vm
```
The operator's own local key at `~/.ssh/hetzner-vm` and
`infra/scripts/hetzner-pilot-tunnel.sh` (launchd-based, interactive use)
are unaffected — this just gives CI its own copy of the same key's
contents, not a replacement for local access.

**Rotation:** if `~/.ssh/hetzner-vm` is ever rotated (new keypair
provisioned for the `deploy` user), re-run the `gh secret set` command
above with the new private key — same "update the repo secret, no
workflow-side change needed" shape as every other Hetzner secret's
rotation.

### `HETZNER_VM_IP` — a GitHub Actions *variable*, not a secret

GitHub issue #708 — found live, first real `cd-hetzner.yml` run:
`infra/scripts/hetzner-pilot-tunnel.sh` (#668) discovers the VM's IP via
`terraform output`, which works interactively (real local state exists)
but not in a CD job — `actions/checkout@v4` gives it a fresh checkout
with no `.terraform/` cache or state file (D101, both gitignored). The
job passes `HETZNER_VM_IP` (`vars.HETZNER_VM_IP`, a plain GitHub Actions
repo *variable*, not `secrets.*` — it's a public IP already resolvable
via DNS, nothing sensitive about it) in as an env var, which
`hetzner-pilot-tunnel.sh`'s `vm_ip()` checks before falling back to
`terraform output`. **Keep this in sync whenever the VM is recreated and
gets a new IP** — same manual-sync caveat as `CLOUDFLARE_API_TOKEN`'s
DNS records above; nothing currently automates either.

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
