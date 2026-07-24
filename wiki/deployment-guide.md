# Build & Deployment Guide

Command-by-command runbook for taking this repo from a clean checkout to
every environment it currently supports — native dev, full Docker
Compose, and the full Kubernetes (`kind`) deployment including the
Phase 11 LocalStack secrets/IAM integration. Each section is
self-contained and can be run independently; they're ordered from
fastest/lightest to most complete.

This is an operational how-to, not a design doc — see `docs/` for
architecture/data-model/decisions/roadmap, and `README.md` for a
shorter quick-start covering the same ground with more prose and less
"just the commands." If a command here and `README.md` ever disagree,
trust whichever was verified more recently against a real run (check
`CLAUDE.md`'s "Current status" for the last confirmed state).

## Prerequisites

```bash
# macOS
brew install --cask docker   # then open Docker Desktop once so the daemon starts
brew install kind kubectl helm awscli
node --version                # need 22+
```

## 1. Native dev loop (fastest — no containers for api/web)

`api`/`web` run directly on the host. **Postgres, OpenSearch, and
Mailpit all live in kind only** (D24/D26/D29 in `docs/DECISIONS.md`) —
reached via port-forward, not `infra/docker-compose.yml`'s containers
(those service definitions stay in the file as inert reference only).
This requires the `kind` cluster from section 3 to already be up.

```bash
# 1. kind cluster must already exist (section 3) — all three live there
kubectl -n interview-insights port-forward svc/postgres 5432:5432 &
kubectl -n interview-insights port-forward svc/opensearch 9200:9200 &
kubectl -n interview-insights port-forward svc/mailpit 1025:1025 8025:8025 &

cd api
cp .env.example .env                     # URLs already point at localhost:5432/9200
npm install
npx prisma migrate deploy
npm run start:dev                        # http://localhost:3001

# separate terminal
cd web
cp .env.example .env.local
npm install
npm run dev                              # http://localhost:3000
```

Verify: `curl http://localhost:3001/health` → `{"status":"ok"}`.

Stop: kill the port-forwards.

**Gotcha:** if `infra/docker-compose.yml`'s OpenSearch or Mailpit
containers happen to also be running, both it (`0.0.0.0` via Docker)
and the port-forward (`127.0.0.1`) can coexist on the same port and
`localhost` becomes ambiguous — the exact silent-wrong-target problem
D24 hit with Postgres.app. Stop the compose container(s)
(`docker stop interview-insights-opensearch-1 interview-insights-mailpit-1`)
before port-forwarding.

### Running `api`'s tests locally

```bash
# unit tests — no DB needed
npm test

# e2e tests — needs the same port-forwards above, with two isolation
# knobs so test runs never litter the real data the deployed app serves:
# - a separate interview_insights_test database on kind's Postgres
#   (created once via `kubectl -n interview-insights exec postgres-0 --
#   psql -U postgres -c "CREATE DATABASE interview_insights_test;"`,
#   kept current via `prisma migrate deploy` against it) — D24
# - OPENSEARCH_INDEX_PREFIX, since OpenSearch has no database concept:
#   test documents land in e2etest-companies/e2etest-reviews instead of
#   the real companies/reviews indices — D26. The e2etest-* indices are
#   disposable; delete anytime with
#   `curl -X DELETE http://localhost:9200/e2etest-*`.
# Mailpit needs no such knob (GitHub issue #144) — mail.e2e-spec.ts
# sends a uniquely-marked test message per run instead, since there's no
# database/index concept to isolate against; messages just accumulate in
# Mailpit's inbox and can be cleared anytime with
# `curl -X DELETE http://localhost:8025/api/v1/messages`.
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/interview_insights_test?schema=public" \
OPENSEARCH_INDEX_PREFIX="e2etest-" \
npm run test:e2e
```

CI (`.github/workflows/ci.yml`) is unaffected by any of this — its `api`
job runs its own fully ephemeral Postgres, OpenSearch, and Mailpit
service containers per run, and the prefix defaults to empty there.

## 2. Full-stack Docker Compose (prod-like images, still no Kubernetes)

```bash
cd infra
docker compose --profile full up --build
```

Builds and runs `api`+`web` as containers alongside `postgres`+
`opensearch`. Migrations apply automatically on `api` container start
(`api/scripts/entrypoint.js` → `api/Dockerfile`'s `CMD`) — no manual
`prisma migrate deploy` step. Same ports as section 1.

## 3. Full Kubernetes deployment on `kind`

**Fast path:** `infra/scripts/bootstrap-kind.sh` (Phase 13 issue #107)
runs every step below (3.1-3.4, plus provisioning/seeding LocalStack
from section 5) in one shot, and is idempotent — safe to re-run against
an already-running cluster; every step either skips or upgrades in
place rather than erroring. Requires `LOCALSTACK_AUTH_TOKEN`,
`ADMIN_PASSWORD_HASH`, and `ADMIN_JWT_SECRET` set in the environment
first (see sections 5 and 5b):

```bash
export LOCALSTACK_AUTH_TOKEN="your_token_here"   # put in ~/.zshenv to persist
export ADMIN_PASSWORD_HASH='the bcrypt hash'     # single-quoted, it contains $
export ADMIN_JWT_SECRET="your_jwt_secret_here"
./infra/scripts/bootstrap-kind.sh
```

The rest of this section is the manual walkthrough the script
automates — useful for understanding what each step actually does, or
for running a single step in isolation while debugging.

**Gotcha found by adversarially rebuilding the cluster from scratch**
(GitHub issue #108): on a genuinely fresh cluster, `api` crash-loops
with `ResourceNotFoundException` if anything waits on `api` reaching
`Ready` before LocalStack has been seeded — `api/scripts/entrypoint.js`
fetches its secrets from LocalStack at boot, and there's nothing to
fetch yet on a cold start. This stayed invisible for a long time because
testing against an already-running cluster never actually restarted
`api` from zero — the bug only surfaced once the cluster was destroyed
and rebuilt for real. Fixed by never waiting on `api` before the seed
step; `cd.yml` already had this right (it only waits on `localstack`,
then seeds, then explicitly rolls `api` out afterward) — the bootstrap
script just hadn't matched that ordering yet.

**Gotcha (now self-healing): `api` could start crash-looping hours or days
after a clean deploy, with no code change involved.** Symptom: `kubectl -n
interview-insights logs -l app=api` shows
`ResourceNotFoundException: Secrets Manager can't find the specified
secret` as the issue #108 gotcha above, but on a cluster that's been
running fine for a while. Root cause: LocalStack's Deployment
(`infra/k8s/base/localstack/08-localstack.yaml`) deliberately has no PVC
— it's a practice/prototype tool, not a source of truth, so its Secrets
Manager/IAM state is `emptyDir`-backed and disappears whenever the
container itself restarts for *any* reason (OOM, node hiccup, `docker
system prune`, etc.), independent of any deploy or `kubectl apply`.

This used to require noticing and re-seeding by hand. It no longer does:
`infra/k8s/base/localstack/init/seed.sh` is mounted into the container at
`/etc/localstack/init/ready.d/` via LocalStack's own
[lifecycle-hooks](https://docs.localstack.cloud/user-guide/lifecycle-hooks/)
mechanism, which runs it automatically every time LocalStack finishes
starting — including after an unplanned restart — so the secrets/IAM
role always exist again before `api`'s own next boot needs them. Verified
by deleting the LocalStack pod directly (not just re-running a script)
and confirming `api` came up clean on its very next `rollout restart`
with zero manual seeding.

If it somehow still happens (e.g. the init-hook itself failed — check
`kubectl -n interview-insights logs deploy/localstack | grep init-hook`),
the same manual recovery still works as a fallback:

```bash
kubectl -n interview-insights port-forward svc/localstack 4566:4566 &
LOCALSTACK_ENDPOINT=http://localhost:4566 ./infra/aws/seed-localstack.sh
kubectl -n interview-insights rollout restart deployment/api
kubectl -n interview-insights rollout status deployment/api --timeout=90s
```

Not fixed with a PVC — that would undo the deliberate "not a source of
truth" tradeoff issue #78 already made for this practice-tier tool. The
init-hook makes the existing "reseed on start" behavior automatic instead
of manual; it doesn't make LocalStack's state durable.

### 3.1 Create an Ingress-ready cluster

A plain `kind create cluster` doesn't route external traffic in — the
Ingress needs `extraPortMappings` + a node label:

```bash
cat <<'EOF' > /tmp/kind-config.yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
    kubeadmConfigPatches:
      - |
        kind: InitConfiguration
        nodeRegistration:
          kubeletExtraArgs:
            node-labels: "ingress-ready=true"
    extraPortMappings:
      - containerPort: 80
        hostPort: 80
      - containerPort: 443
        hostPort: 443
EOF
kind create cluster --name interview-insights --config /tmp/kind-config.yaml
```

### 3.2 Install ingress-nginx via Helm

Third-party infra stays on Helm; this project's own manifests stay on
Kustomize (`docs/DECISIONS.md` D19).

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace \
  --set controller.hostPort.enabled=true \
  --set controller.service.type=ClusterIP \
  --set controller.nodeSelector."kubernetes\.io/os"=linux
kubectl -n ingress-nginx wait --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller --timeout=180s
```

### 3.3 Build and load the `api`/`web` images

`NEXT_PUBLIC_API_URL` is a Next.js build-time value (inlined into the
client bundle), not a runtime env var — it must be a `--build-arg`
matching the Ingress host below:

```bash
docker build -t interview-insights-api:k8s -f api/Dockerfile api
docker build -t interview-insights-web:k8s -f web/Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=http://api.interview-insights.local web
kind load docker-image interview-insights-api:k8s interview-insights-web:k8s \
  --name interview-insights
```

### 3.4 Apply the `dev` overlay

```bash
kubectl apply -k infra/k8s/overlays/dev
kubectl -n interview-insights get pods    # all four should reach 1/1 Running
```

### 3.5 Reach it

The Ingress routes `app.interview-insights.local` (web) and
`api.interview-insights.local` (api) — neither resolves anywhere by
default. Either add both to `/etc/hosts` pointing at `127.0.0.1`, or use
`curl --resolve` to avoid touching a system file:

```bash
curl --resolve app.interview-insights.local:80:127.0.0.1 http://app.interview-insights.local/
curl --resolve api.interview-insights.local:80:127.0.0.1 http://api.interview-insights.local/health
```

To reach Postgres/OpenSearch/Mailpit directly (e.g. a DB client, or
Mailpit's web UI at `localhost:8025`) — the Postgres one is also
section 1's actual local-dev Postgres access path now, not just an ad
hoc DB-client shortcut (D24):

```bash
kubectl -n interview-insights port-forward svc/postgres 5432:5432
kubectl -n interview-insights port-forward svc/opensearch 9200:9200
kubectl -n interview-insights port-forward svc/mailpit 1025:1025 8025:8025
```

### 3.6 k9s + metrics-server (cluster monitoring, Phase 12)

Lightweight local tooling only — not a full observability stack
(Prometheus/Grafana/Loki/Jaeger stay gated on Phase 8f's own "local
equivalent" bullet, for a real shared/staging trigger). GitHub issue
#90.

**`metrics-server`** — third-party infra, so it's Helm-installed like
`ingress-nginx` (`docs/DECISIONS.md` D19), not a Kustomize-managed
manifest of our own. `kind`'s kubelet certs aren't set up for
`metrics-server`'s default TLS verification against a real CA, hence
the well-known `--kubelet-insecure-tls` patch:

```bash
helm repo add metrics-server https://kubernetes-sigs.github.io/metrics-server/
helm repo update
helm install metrics-server metrics-server/metrics-server \
  --namespace kube-system \
  --set args={--kubelet-insecure-tls}
kubectl -n kube-system wait --for=condition=ready pod \
  --selector=app.kubernetes.io/name=metrics-server --timeout=120s
```

Verify against the real cluster (takes ~30-60s after install before
the API is warm):

```bash
kubectl top nodes
kubectl top pods -n interview-insights
```

**`k9s`** — terminal UI for navigating the cluster (pods, logs,
describe, exec, live resource usage from `metrics-server` above). Zero
footprint, no manifests of its own:

```bash
brew install k9s
k9s -n interview-insights
```

`k9s`'s Pods view shows the same CPU/memory columns `kubectl top pods`
does, sourced from the same `metrics-server` — if `kubectl top` errors,
`k9s`'s resource columns will be blank too; fix `metrics-server` first.

## 4. Redeploying after a code change

Rebuild the image, reload it into `kind` (same tag, so `kind load`
replaces the cached one), then force a rollout — `kind`'s node won't
notice a same-tagged image changed on its own:

```bash
docker build -t interview-insights-api:k8s -f api/Dockerfile api
kind load docker-image interview-insights-api:k8s --name interview-insights
kubectl -n interview-insights rollout restart deployment/api
kubectl -n interview-insights rollout status deployment/api --timeout=90s
```

Same pattern for `web`, swapping the image name and the `--build-arg`
from section 3.3 if it changed.

A ConfigMap/Secret value change alone (no image change) still needs the
`rollout restart` — `envFrom` doesn't hot-reload into a running pod.

**This is now automated** (`.github/workflows/cd.yml`, GitHub issues
#89/#99) — every one of these exact steps, plus the full LocalStack
provisioning/seeding sequence from section 5 below, runs on a push to
`main` that touches `api/**`, `web/**`, or `infra/k8s/**`, on the
self-hosted runner from section 7. Since that runner is on-demand, the
job just queues until `./run.sh` is next started — start it whenever a
merge should actually reach the cluster. `GET /health`'s `version`
field (the short commit SHA, baked in at build time via `--build-arg
GIT_SHA`) confirms exactly which commit is live after a deploy —
`curl http://api.interview-insights.local/health`.

## 5. LocalStack secrets/IAM integration (Phase 11-12)

Extends section 3 so `api` fetches its real secrets from LocalStack via
an assumed IAM role, instead of the plaintext `api-secrets` k8s
`Secret`. As of GitHub issue #99 (`docs/DECISIONS.md` D23), this is
CD's actual deploy target (`infra/k8s/overlays/dev-localstack`) — not
just an occasional manual walkthrough. It's still structurally opt-in
relative to the plain `dev` overlay (`docs/DECISIONS.md` D20/D22):
nothing here is in base `kustomization.yaml`'s resources list, and
`kubectl apply -k infra/k8s/overlays/dev` still gets the plaintext-Secret
behavior back if ever applied directly.

**One-time setup, only needed once per cluster** (CD handles all of this
itself on every run afterward — see below):

```bash
# 1. Auth token (LocalStack requires one to start, even free tier) —
#    get one at app.localstack.cloud, then set it as the repo secret CD
#    reads (LOCALSTACK_AUTH_TOKEN in cd.yml):
gh secret set LOCALSTACK_AUTH_TOKEN

# Only needed if you also want to apply this overlay manually, outside
# CD (e.g. testing a change to infra/k8s/base/localstack/ before pushing):
export LOCALSTACK_AUTH_TOKEN="your_token_here"   # put in ~/.zshenv to persist
kubectl create secret generic localstack-credentials \
  --namespace interview-insights \
  --from-literal=LOCALSTACK_AUTH_TOKEN="$LOCALSTACK_AUTH_TOKEN"
```

**What CD does on every push** (same steps, runnable by hand too):

```bash
# 2. Apply the overlay that adds LocalStack + opts api's ConfigMap in
kubectl apply -k infra/k8s/overlays/dev-localstack
kubectl wait --for=condition=ready pod -l app=localstack -n interview-insights --timeout=120s

# 3. Seed the two secrets api needs + the IAM role/policy (idempotent —
#    CD reseeds fresh on every run, since LocalStack keeps no state
#    across pod restarts, see the gotcha below)
kubectl -n interview-insights port-forward svc/localstack 4566:4566 &
./infra/aws/seed-localstack.sh

# 4. Restart api to pick up SECRETS_SOURCE=localstack (rebuild first if
#    api/src changed — see section 4)
kubectl -n interview-insights rollout restart deployment/api
kubectl -n interview-insights rollout status deployment/api --timeout=90s
```

Verify it's actually using LocalStack, not just reachable: create a
candidate through the API, then compare the stored `email_hash` in
Postgres against an HMAC computed with the LocalStack-seeded secret
value (`localstack-seeded-secret-change-me` by default) vs. the
plaintext k8s Secret's value (`dev-only-change-me`) — only the former
should match. See `wiki/blog/phase-11-integrated-prototype/
issue-79-secrets-boot-wiring/README.md` for the full worked example.

**Gotcha: `api` crash-loops with `ResourceNotFoundException` after a
`docker stop`/`docker start` of the `kind` node, outside of a CD run.**
LocalStack's Deployment has no PVC by design (it's a practice tool, not
a source of truth, see `infra/k8s/base/localstack/08-localstack.yaml`'s
own comment) — its in-memory secrets/IAM state doesn't survive the pod
restarting alongside the node. A CD run fixes this on its own (step 3
above reseeds unconditionally); if you need it fixed before the next
push, re-run step 3 by hand against the restarted LocalStack pod, then
`rollout restart deployment/api` again.

## 5b. Admin credential rotation (GitHub issue #192, Phase 18)

`ADMIN_PASSWORD_HASH` and `ADMIN_JWT_SECRET` are deliberately **not** in
any git-tracked manifest — `infra/k8s/base/05-api.yaml`'s `api-secrets`
Secret only ever holds `DATABASE_URL`/`EMAIL_HASH_SECRET` now. A "real"
rotated admin credential committed to a manifest would be exactly as
public as the dev-only placeholder it replaced (`bcrypt("dev-only-admin-
password")`, `"dev-only-change-me-too"` — both still fine to use in
`api/.env` for native local dev, which never leaves `localhost`). Both
keys instead live in a separate `admin-credentials` Secret, provisioned
imperatively — same pattern as `localstack-credentials`/
`LOCALSTACK_AUTH_TOKEN` above (`docs/DECISIONS.md` D23).

**One-time setup:**

```bash
# Generate real values — never reuse the dev-only ones above for
# anything actually deployed:
NEW_PASSWORD=$(openssl rand -base64 24)
NEW_JWT_SECRET=$(openssl rand -hex 32)
node -e "require('bcryptjs').hash(process.argv[1], 10).then(h => console.log(h))" "$NEW_PASSWORD"
# Save NEW_PASSWORD and the printed hash somewhere outside git (a
# password manager entry is sufficient at today's single-admin scale)

gh secret set ADMIN_PASSWORD_HASH   # paste the bcrypt hash, not the password
gh secret set ADMIN_JWT_SECRET      # paste NEW_JWT_SECRET

# Only needed to apply this manually, outside CD (e.g. testing before
# pushing, or infra/scripts/bootstrap-kind.sh's own use of these same vars):
export ADMIN_PASSWORD_HASH="the bcrypt hash, single-quoted — it contains \$"
export ADMIN_JWT_SECRET="NEW_JWT_SECRET's value"
kubectl create secret generic admin-credentials \
  --namespace interview-insights \
  --from-literal=ADMIN_PASSWORD_HASH="$ADMIN_PASSWORD_HASH" \
  --from-literal=ADMIN_JWT_SECRET="$ADMIN_JWT_SECRET"
```

**What CD does on every push** (`cd.yml`'s "Provision admin credentials
secret" step, right before the LocalStack one): upserts
`admin-credentials` from the two repo secrets, before the overlay apply
that (re)creates `deployment/api`'s pod — same "doesn't hot-reload"
ordering requirement LocalStack's own credential has.

**To rotate again later:** repeat the one-time setup with fresh values,
then either push anything that triggers CD, or run
`kubectl -n interview-insights rollout restart deployment/api` by hand
after re-running the `kubectl create secret` command above. The *old*
password stops working the moment the new Secret is live and `api`
restarts — there's no overlap window, matching this project's single-
admin, single-credential scope (`docs/ROADMAP.md` Phase 18).

## 6. Smoke-testing the whole stack end to end

Whichever environment from sections 1-5 is up, the same golden path
proves every service is actually communicating:

```bash
# 1. Create a company, candidate/process, round, and rating through the
#    web UI (or curl the API directly per README.md's endpoint table) —
#    the rating comes back `pending` (CLAUDE.md hard constraint #2).

# 2. Approve it
curl -X POST http://localhost:3001/moderation/queue/<queue-id>/approve

# 3. Confirm it's now public
curl http://localhost:3001/rounds/<round-id>/ratings

# 4. Refresh the analytics views and check the endpoint (k8s: exec into
#    postgres, or connect a DB client via the port-forward from 3.5)
psql -c "REFRESH MATERIALIZED VIEW company_round_type_aggregates;"
curl http://localhost:3001/companies/<company-id>/analytics

# 5. Confirm search finds it
curl "http://localhost:3001/search/companies?q=<name>"
curl "http://localhost:3001/search/reviews?companyId=<company-id>"
```

Swap `localhost:3001` for `http://api.interview-insights.local` when
running against `kind` (section 3).

### 6.1 Automated golden-path smoke test

The manual walkthrough above is a quick one-off check; for the full
feature set (every moderated content type, update/delete, GDPR
erasure — not just round ratings) there's a single automated test that
does the same thing without copying IDs by hand:

```bash
cd api
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/interview_insights_test?schema=public" \
OPENSEARCH_INDEX_PREFIX="e2etest-" \
MAIL_HTTP_URL="http://localhost:8025" \
npm run smoke:e2e
```

`api/test/golden-path.smoke-spec.ts` walks company creation, candidate
magic-link auth, all three moderated content types, moderation approve/
reject, search, analytics (clearing the shrinkage floor for a real
score), my-reviews, update/delete, and GDPR erasure in one continuous
pass. It refuses to run unless `DATABASE_URL` points at
`interview_insights_test` (`assertUsingTestDatabase()`,
docs/DECISIONS.md D36) — safe to rerun on demand, deliberately **not**
wired into `npm run test:e2e` or CI, since the per-feature e2e specs
already own regression coverage; this is a manual sanity check.

### 6.2 Cleaning up manual, ad hoc verification data safely

The smoke test above (6.1) cleans up after itself — it targets the
isolated test database and its own `e2etest-` OpenSearch prefix. Manual
one-off verification against the real dev cluster (e.g. seeding a
company through the real API to check a specific UI behavior live, the
way Phase 21's soft-gate verification did) has no such isolation, and
naive cleanup leaves real residue (docs/DECISIONS.md D44, a real
incident, not a hypothetical): deleting rows directly from Postgres
mirrors none of the side effects the app's own service layer would have
applied on a real delete.

**If you created data through the real API** (so it's genuinely
indexed/queued, not just inserted), deleting it afterward needs **all
three** of the following, in this order — not just the Postgres rows:

1. **Gather the ids first** — `moderation_queue` has no foreign key to
   any entity table (it's deliberately polymorphic, covering three
   entity types), so once the underlying row is gone there's no way to
   find its queue entry again:
   ```sql
   SELECT id FROM round_ratings WHERE ... ; -- note the ids
   ```
2. **Delete the `moderation_queue` entries**, then the entities
   themselves, in FK-safe order (round_ratings → rounds →
   overall_reviews → interview_processes → companies → candidates):
   ```sql
   DELETE FROM moderation_queue WHERE entity_id IN (<ids from step 1>);
   ```
3. **Delete the OpenSearch documents** — the `companies` index's
   document id is the company's **UUID, not its slug** (confirmed
   directly: deleting by slug silently returns `"result":"not_found"`,
   which looks like success in a script that doesn't check the
   response body):
   ```bash
   kubectl -n interview-insights exec opensearch-0 -- \
     curl -s -X DELETE "http://localhost:9200/companies/_doc/<company-uuid>"
   ```
   Then force a refresh before trusting a "did it actually work" check
   — `_search` can lag a `_delete` by up to the index's refresh
   interval, and a stale read looks identical to a failed delete:
   ```bash
   kubectl -n interview-insights exec opensearch-0 -- \
     curl -s -X POST 'http://localhost:9200/companies/_refresh'
   ```

This is a checklist, not a script, deliberately (D44) — the real
delete/erasure code paths (issue #150, GDPR erasure) already do all of
this correctly every time; the gap only exists when verification work
bypasses the app entirely via raw SQL, which is inherently a one-off,
manual situation each time it happens.

## 7. Self-hosted GitHub Actions runner (on-demand, Phase 12)

Registered once; started manually whenever a workflow needs to run on
this machine (e.g. the CD workflow, issue #89) — deliberately **not** a
persistent service (`svc.sh install`), so nothing on this machine
executes repo-triggered code unless a session explicitly turned the
runner on.

Installed as a sibling of the repo (`~/workspace/actions-runner-interview-insights`),
never inside `interview-insights` itself: the runner's own `_work/`
directory does its own `git checkout` of this repo per job, so nesting
the runner inside the repo it serves would put a git checkout inside
another git working tree. The install also carries credential files
(`.credentials`, `.credentials_rsaparams`) — keeping them outside any
tracked tree makes it structurally impossible for a stray `git add -A`
to pick them up. Same reasoning GitHub's own runner docs give for always
installing to a dedicated directory outside any repo checkout.

**One-time registration** (re-run only if re-registering, e.g. after a
token expires or on a new machine):

```bash
mkdir -p ~/workspace/actions-runner-interview-insights && cd ~/workspace/actions-runner-interview-insights
RUNNER_VERSION=$(curl -s https://api.github.com/repos/actions/runner/releases/latest | python3 -c "import json,sys; print(json.load(sys.stdin)['tag_name'].lstrip('v'))")
curl -o runner.tar.gz -L "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-osx-arm64-${RUNNER_VERSION}.tar.gz"
tar xzf runner.tar.gz

TOKEN=$(gh api -X POST repos/GowthamSiddarth/interview-insights/actions/runners/registration-token --jq '.token')
./config.sh --url https://github.com/GowthamSiddarth/interview-insights \
  --token "$TOKEN" --name "interview-insights-local" \
  --labels "self-hosted,macOS,local-kind" --work "_work" --unattended
```

**Start it (on-demand)** right before a run you want executed locally
is expected — `--once` processes a single queued job then exits on its
own:

```bash
cd ~/workspace/actions-runner-interview-insights
./run.sh --once
```

Verify it's alive with `.github/workflows/self-hosted-smoke-test.yml`
(`workflow_dispatch` only, never fires on its own):

```bash
gh workflow run self-hosted-smoke-test.yml --ref main
gh run watch --exit-status $(gh run list --workflow=self-hosted-smoke-test.yml --limit 1 --json databaseId --jq '.[0].databaseId')
```

`gh api repos/:owner/:repo/actions/runners` shows `offline` when nothing
is running — expected between sessions; that's the intended state for
an on-demand runner, not a problem to fix.

## 8. CD workflow: from merge to redeploy (Phase 12)

Before any of this runs, `.github/workflows/ci.yml`'s `infra` job
(GitHub-hosted, no cluster needed, Phase 13 issue #106) already
validated the PR: `kubectl kustomize` against all four overlays
(`dev`, `dev-localstack`, `staging`, `prod`) to catch a broken Kustomize
edit, and a build-only `docker build` for both `api/Dockerfile` and
`web/Dockerfile` to catch a Dockerfile regression — both at PR time,
on every PR, regardless of whether the self-hosted runner is ever
started. Previously, a broken manifest or Dockerfile would merge with
a green CI check and only fail later, when the real CD job tried to
build/apply it against the live cluster.

What actually happens between a PR landing on `main` and the `kind`
cluster running the new code, step by step:

1. **A PR is merged to `main`** (`gh pr merge --squash`, or the GitHub
   UI) — a normal push to `main`.
2. **GitHub evaluates `.github/workflows/cd.yml`'s trigger.** It's a real
   `push: branches: [main]` trigger (not `workflow_dispatch` — a
   deliberate choice, see the workflow's own header comment), scoped
   with a `paths` filter to `api/**`, `web/**`, `infra/k8s/**`. A merge
   that only touches docs/wiki/blog content doesn't queue a job at all.
3. **The job queues, it doesn't run yet.** `runs-on: self-hosted` with
   no runner currently listening means the job sits `Queued` on GitHub's
   side — nothing executes on this machine until the runner is started
   (section 7).
4. **Concurrency control:** the job runs under `concurrency: group: cd,
   cancel-in-progress: true`. A second qualifying push to `main` while
   an earlier CD run is still queued or in progress cancels the earlier
   one outright — only the latest `main` is ever worth deploying to a
   single local cluster.
5. **The runner is started on-demand** (section 7):
   ```bash
   cd ~/workspace/actions-runner-interview-insights && ./run.sh --once
   ```
   This is the deliberate manual gate from issue #88 — nothing
   repo-triggered executes here until this command runs. `--once` picks
   up exactly one queued job then exits on its own.
6. **The runner executes the queued job's steps, in order:**
   - `actions/checkout@v4` checks out the merged `main` commit.
   - **Build `api` image** — `docker build -f api/Dockerfile`, tagged
     `interview-insights-api:k8s`, with the short commit SHA baked in
     via `--build-arg GIT_SHA` (surfaced later at `GET /health`).
   - **Build `web` image** — `docker build -f web/Dockerfile`, tagged
     `interview-insights-web:k8s`, with `NEXT_PUBLIC_API_URL` passed as
     a build arg — it has to be set at build time, not runtime, per the
     Next.js inlining bug fixed in Phase 7 issue #28.
   - **Load images into kind** — `kind load docker-image ... --name
     interview-insights` pushes both images straight into the cluster's
     node containers, no registry involved.
   - **Ensure the namespace exists** — `kubectl apply -f
     infra/k8s/base/00-namespace.yaml`, idempotent, mostly relevant to a
     truly fresh cluster.
   - **Provision the admin credentials Secret** — upserts
     `admin-credentials` from the `ADMIN_PASSWORD_HASH`/
     `ADMIN_JWT_SECRET` repo secrets, before the overlay below ever
     (re)creates api's Deployment (GitHub issue #192, section 5b) — same
     ordering requirement as the LocalStack step right after this one.
   - **Provision the LocalStack auth token Secret** — upserts
     `localstack-credentials` from the `LOCALSTACK_AUTH_TOKEN` repo
     secret, before the overlay below ever creates the LocalStack pod
     (GitHub issue #99, `docs/DECISIONS.md` D23).
   - **Apply the dev-localstack overlay** — `kubectl apply -k
     infra/k8s/overlays/dev-localstack` reconciles every manifest
     (namespace, secrets, configmaps, both Deployments/Services, the
     Ingress, the Postgres/OpenSearch StatefulSets, and now LocalStack)
     declaratively.
   - **Wait for LocalStack, then seed it** — `kubectl wait
     --for=condition=ready pod -l app=localstack`, then a backgrounded
     `port-forward` + `infra/aws/seed-localstack.sh` (idempotent — see
     section 5) recreates the two secrets `api` needs plus the IAM
     role/policy, fresh every run, since LocalStack keeps no state
     across pod restarts.
   - **Roll out `api`** — `kubectl rollout restart deployment/api` (the
     image tag string is unchanged even though its content is new, so a
     restart is what actually forces new pods to pull the freshly-loaded
     image) then `rollout status --timeout=90s` blocks until the new pod
     is `Ready` and the old one is gone.
   - **Roll out `web`** — same restart + status-wait for
     `deployment/web`.
7. **Job reports success**, `run.sh --once` exits on its own, and the
   runner goes back to `offline` — expected steady state, not a problem
   (section 7).
8. The new code is live behind the existing Ingress hosts
   (`app.interview-insights.local`, `api.interview-insights.local`) with
   no further manual step. Confirm exactly which commit is live via
   `curl http://api.interview-insights.local/health`'s `version` field.

## 9. Tearing down

```bash
# Docker Compose (sections 1-2)
cd infra && docker compose down          # add -v to also wipe volumes

# kind cluster (section 3) — stop without losing state, resume later:
docker stop interview-insights-control-plane
docker start interview-insights-control-plane   # resumes exactly where it left off

# kind cluster — fully destroy (irreversible, loses all in-cluster data):
kind delete cluster --name interview-insights

# self-hosted runner (section 7) — nothing to stop if using --once (it
# already exited); Ctrl+C if run without --once
```

## 10. Migrating to a new machine

Everything in this repo is designed to be rebuilt from nothing (Phase 13
issue #108 proved it), which makes a machine migration mostly a matter of
following that same discipline rather than trying to carry over live
state. **Don't try to preserve the running `kind` cluster or Docker
Desktop's state across a migration** — both are notoriously fragile
across a fresh install, and this repo has a one-shot script built for
exactly this situation.

**What never needs migrating**: GitHub itself (repo, issues, PRs, project
board, milestones), the `LOCALSTACK_AUTH_TOKEN`/`ADMIN_PASSWORD_HASH`/
`ADMIN_JWT_SECRET` GitHub Actions repo secrets CD reads, and LocalStack's
own secrets/IAM state (ephemeral by design, D25 — it self-seeds on any
fresh cluster via its init-hook).

1. **Verify what actually transferred** before doing anything else:

   ```bash
   ls ~/workspace/interview-insights ~/workspace/actions-runner-interview-insights
   cd ~/workspace/interview-insights && git status && git remote -v && git fetch
   ssh -T git@github.com                          # SSH key for pushing
   grep LOCALSTACK_AUTH_TOKEN ~/.zshenv ~/.zshrc   # confirm the line came over (don't print the value)
   ```

2. **Reinstall tooling fresh** — don't trust a migrated Docker Desktop
   install:

   ```bash
   brew install --cask docker   # open once to init the daemon
   brew install kind kubectl helm awscli gh k9s
   node --version                # need 22+; brew install node if missing
   ```

3. **Re-auth `gh`** (a bare `gh auth login` omits the `project` scope —
   see `wiki/github-project-setup.md`'s own gotcha):

   ```bash
   gh auth login --scopes "repo,project"
   gh auth status   # must show 'project' in Token scopes
   ```

4. **Rebuild the cluster from scratch** (section 3's fast path):

   ```bash
   cd ~/workspace/interview-insights
   export LOCALSTACK_AUTH_TOKEN="..."   # same token; add to ~/.zshenv to persist
   export ADMIN_PASSWORD_HASH='...'     # same hash — single-quoted, it contains $
   export ADMIN_JWT_SECRET="..."        # same secret
   ./infra/scripts/bootstrap-kind.sh
   ```

   The values are the same ones already in the `ADMIN_PASSWORD_HASH`/
   `ADMIN_JWT_SECRET` GitHub Actions repo secrets (section 5b) — CD
   itself doesn't need re-configuring, only this machine's local
   bootstrap run does, since `bootstrap-kind.sh` reads from the
   environment rather than from GitHub.

5. **Recreate `api/.env` / `web/.env.local`** if the gitignored files
   didn't survive the transfer (`cp api/.env.example api/.env`,
   `cp web/.env.example web/.env.local`).

6. **Register a fresh self-hosted runner — don't copy the old one's
   credentials.** A runner's `.credentials` file is tied to its
   registration; the supported path is retiring the old one and
   registering a new one, not copying files across:
   - Old machine (or GitHub's web UI): Settings → Actions → Runners →
     remove `interview-insights-local`.
   - New machine: follow section 7 above verbatim (fresh download + a
     new registration token via `gh api`).

7. **Do not reinstall Postgres.app.** D24 documents exactly why — it
   silently intercepted connections meant for this project's Postgres
   on the old machine. The convention now is `kind`-only Postgres (and
   OpenSearch, D26); skip installing it on the new machine entirely.

8. **Full verification pass** — build/test both apps, then the golden
   path through the real Ingress-fronted app (same as section 6's
   smoke test):

   ```bash
   cd api && npm install && npm run build && npm test
   cd ../web && npm install && npm run build && npm test

   # one-time: the isolated e2e test database (D24)
   kubectl -n interview-insights exec postgres-0 -- psql -U postgres -c "CREATE DATABASE interview_insights_test;"
   cd ../api && DATABASE_URL="postgresql://postgres:postgres@localhost:5432/interview_insights_test?schema=public" npx prisma migrate deploy

   kubectl -n interview-insights port-forward svc/postgres 5432:5432 &
   kubectl -n interview-insights port-forward svc/opensearch 9200:9200 &
   kubectl -n interview-insights port-forward svc/mailpit 1025:1025 8025:8025 &
   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/interview_insights_test?schema=public" \
   OPENSEARCH_INDEX_PREFIX="e2etest-" npm run test:e2e

   curl --resolve app.interview-insights.local:80:127.0.0.1 http://app.interview-insights.local/
   ```

**If the data in the old cluster's Postgres actually matters** (it
normally doesn't — every verification in this project's history has
been disposable dev/test data): `pg_dump` it from the old machine before
decommissioning, then restore into the new cluster's `postgres-0` after
step 4. Not documented step-by-step here since it's never actually been
needed yet — revisit if that changes.
