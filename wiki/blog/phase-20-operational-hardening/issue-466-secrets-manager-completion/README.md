# Phase 20, Issue #466 — Closing Out the Last Plaintext Secrets

*Part of Phase 20 — Operational Hardening & Live-Verification Findings.
Epic #214 reopened, same precedent as
#222/#240/#278/#312/#347/#349/#387/#389. See `docs/ROADMAP.md` Phase 20
and `docs/DECISIONS.md` D76/D77.*

## The last four plaintext holdouts

Issue #335 (Phase 31) added `EMAIL_ENCRYPTION_KEY` to both `api`'s and
`notification-service`'s Secrets, as a committed `"1111...1111"`
placeholder — the same "dev-only, change-me" shape `EMAIL_HASH_SECRET`
and `CANDIDATE_JWT_SECRET` already had, and the same shape
`postgres-credentials` had carried since Phase 7. A direct follow-up
request asked the obvious question this raised: if `DATABASE_URL`/
`EMAIL_HASH_SECRET` already fetch from LocalStack Secrets Manager
(issues #78/#79, Phase 11), why do these other four still sit in git as
plaintext? There was no good answer — just accumulated exceptions.
That request became CLAUDE.md's hard constraint #6 ("no secret ever
committed as plaintext, not even a placeholder") and this issue is where
the four exceptions it named got closed out.

Two of the four were straightforward: extend `api`'s existing
`localstack-secrets-bootstrap.ts` to also fetch `EMAIL_ENCRYPTION_KEY`/
`CANDIDATE_JWT_SECRET`, the same `Promise.all` pattern it already used
for the first two. The other two — notification-service's own copies,
and `postgres-credentials` — didn't fit that pattern cleanly, and the
issue deliberately flagged both as open questions rather than
pre-resolving them.

## Key concept: `dev-localstack` was already dead weight

`api-secrets`'s `EMAIL_ENCRYPTION_KEY`/`CANDIDATE_JWT_SECRET` existed as
plaintext specifically to serve the plain `dev` overlay — `dev-localstack`
composed `dev` with LocalStack, but `dev` itself never required it, so
something had to keep serving `dev` a plaintext value. Removing that
fallback meant `dev` would have nothing left to read.

Reading `cd.yml` and `bootstrap-kind.sh` before touching anything settled
it: **neither ever applied plain `dev`.** Both had exclusively targeted
`dev-localstack` since issue #99 (D23) — the "opt-in variant" framing
was true in the manifests but not in practice. `dev-localstack`'s only
remaining real purpose was the escape hatch `wiki/deployment-guide.md`
described in so many words: "`kubectl apply -k infra/k8s/overlays/dev`
still gets the plaintext-Secret behavior back." That's precisely what
constraint #6 exists to close off.

So D76: fold `dev-localstack`'s LocalStack resource and ConfigMap
patches directly into `dev`, unconditionally, and delete the now-fully-
redundant overlay outright. Not a deprecation, not an alias — since
nothing ever exercised the plaintext path in the first place, this
changes zero real deploy behavior.

## Key concept: Postgres can't fetch its own bootstrap credential

`postgres-credentials` doesn't fit the LocalStack-at-boot pattern at
all: that pattern requires *this project's own NestJS code* to already
be running so it can call `AssumeRole`/`GetSecretValue` before anything
else needs the value. Postgres is a stock `postgres:16-alpine` image —
its own `initdb` needs `POSTGRES_PASSWORD` before any of this project's
code has ever executed. There's no bootstrap sequence that fetches a
secret before the thing needing it exists.

The fix wasn't a new pattern — it was recognizing an existing one
already solved exactly this shape of problem. `admin-credentials`
(issue #192) is a real credential that's never committed, provisioned
imperatively (`kubectl create secret ... --from-literal=$ENV_VAR`,
hard-failing if unset) before the consuming Deployment is created. D77:
apply that same pattern to `postgres-credentials`, verbatim.
`POSTGRES_USER`/`POSTGRES_DB` aren't credentials at all — they moved to
a plain `postgres-config` ConfigMap, the same non-secret status
`ADMIN_USERNAME` already had.

## Key concept: duplicate the infrastructure, not the code

`notification-service` needed the exact same LocalStack-at-boot
capability `api` already had, but D73/D75 (Phase 31) had already settled
this project's answer for "should these two services share code": no —
duplicate the small amount of infrastructure each needs rather than
build shared tooling for a two-consumer case. So `notification-service`
got its own `aws-client-config.util.ts`/`localstack-secrets-bootstrap.ts`
copies, its own IAM role (`notification-service-secrets-role`), and its
own least-privilege policy scoped to only the two secrets it actually
needs (`database-url`, `email-encryption-key` — not
`email-hash-secret`/`candidate-jwt-secret`, which only `api` reads).
`email-encryption-key` itself stays a *single* Secrets Manager entry,
read by two different roles — D74 already required both services see
byte-identical values, so the two roles reading the one entry is what
makes that guarantee structural rather than something to keep in sync
by hand.

## Step-by-step: what actually got built and verified

1. `api/src/secrets/localstack-secrets-bootstrap.ts` extended to fetch
   `EMAIL_ENCRYPTION_KEY`/`CANDIDATE_JWT_SECRET` alongside the existing
   two; its IAM policy JSON and `seed-localstack.sh` extended to match.
2. `notification-service`'s own bootstrap module, IAM role, and policy
   JSON, wired into its `main.ts` the same way `api`'s already was.
3. `dev-localstack` deleted; its LocalStack resource and both services'
   ConfigMap patches folded into `dev`'s own `kustomization.yaml`.
   `api-secrets`/`notification-service-secrets` Secrets deleted outright
   from `infra/k8s/base` — nothing reads them once the bootstrap always
   runs.
4. `01-postgres-secret.yaml` → `01-postgres-config.yaml` (now a
   ConfigMap); `postgres-credentials` provisioning added to `cd.yml`
   and `bootstrap-kind.sh`, matching `admin-credentials`'s exact shape.
5. `docs/DECISIONS.md` D76/D77 written up, with a "superseded by D76"
   addendum on D23 rather than silently editing its original framing.
6. `.github/workflows/ci.yml`'s Kustomize-build validation updated —
   three overlays now, not four.

## A bug live verification caught, twice

Planning caught the two open design questions. It didn't catch two bugs
that only surfaced once each piece was actually run for real —
consistent with this phase's whole reason for existing (issues
#215/#216/#212/#217 were exactly this same pattern).

**The seeding logic was duplicated in a second place nobody remembered
to update.** `infra/aws/seed-localstack.sh` runs *outside* the LocalStack
container (CD, `bootstrap-kind.sh`, a human); `infra/k8s/base/localstack/
init/seed.sh` is a second, functionally identical copy that runs *inside*
the container as a lifecycle-hook, so LocalStack can reseed itself
automatically after an unplanned restart (it has no PVC, D20 — its
Secrets Manager state doesn't survive a restart otherwise). The PR
updated the outer script and shipped. Only a post-merge static sweep of
the repo (`grep -r` for old plaintext values, done while verifying the
merged work rather than while writing it) surfaced that the in-container
copy still only seeded the original two secrets and `api`'s role —
an unplanned LocalStack restart would have silently regressed
`notification-service` back to a crash-loop, and nobody would have
connected the dots to this PR. Fixed as its own immediate follow-up
commit, with both scripts' header comments now saying explicitly:
*if one changes, the other must too.*

**The verification script itself checked the wrong thing, and running
it against a real cluster is what proved that.** The first version of
`infra/aws/verify-secrets-manager.sh` tried to confirm `api`'s pod
actually had `EMAIL_ENCRYPTION_KEY` set by running `kubectl exec ... --
printenv EMAIL_ENCRYPTION_KEY`. That looked reasonable and passed code
review — it's wrong for a subtle reason: `bootstrapSecretsFromLocalStack()`
sets `process.env.EMAIL_ENCRYPTION_KEY` inside the *already-running*
Node process. `kubectl exec` spawns a **brand-new** process inside the
container, which only ever sees the environment the container was
created with (`envFrom`, etc.) — and since this same PR deliberately
removed these vars from `envFrom` entirely, `printenv` was guaranteed to
show nothing, whether or not the LocalStack fetch had actually succeeded.
The first real run against the live cluster returned four `FAIL`s on a
perfectly healthy deployment — the exact kind of false negative a
verification tool exists to *not* produce. The fix: check pod
readiness and restart count instead. The bootstrap function has no
fallback and throws on any failure, so a `Ready` pod with zero restarts
is only reachable if the fetch actually succeeded — an externally
observable fact, unlike a value that only ever lived inside one
process's own memory.

## What this enabled

Every secret this project's own code manages now follows exactly one of
two documented patterns — fetched from LocalStack at boot, or
provisioned imperatively for the one case (Postgres) where that's not
possible — with no third, undocumented shape left anywhere.
`docs/SECRETS.md` now gives that inventory a permanent home, and
`infra/aws/verify-secrets-manager.sh` gives it a repeatable, automated
check instead of a manual walkthrough redone from memory each time.
