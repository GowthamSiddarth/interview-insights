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
brew install podman kind kubectl helm awscli
# Fresh machine, nothing set up yet:
podman machine init --rootful --memory 8192   # rootful, not rootless -- rootless kind
podman machine start                          # nodes never reach Ready (D84); one-time,
                                               # see section 3. 8GB, not podman's own 2GB
                                               # default (D91) -- the full kind stack
                                               # (control plane + ingress-nginx +
                                               # Postgres/OpenSearch/Redpanda/LocalStack/
                                               # api/web/notification-service/
                                               # review-analyzer) pegs a 2GB machine's CPU
                                               # near 100% continuously, which cascades
                                               # into kube-controller-manager/kube-scheduler
                                               # CrashLoopBackOff -- not a Podman bug, a
                                               # genuine sizing requirement.
# Already have a rootless `podman-machine-default` from before (D83), or
# one sized below 8GB?
#   podman machine stop && podman machine set --rootful --memory 8192 && podman machine start
node --version                  # need 22+
```

Docker Desktop is no longer required for anything in this guide (GitHub
issue #540, D89/D90 superseded D83's "kind/CI/CD stay Docker" carve-out —
`kind` now runs against the same `podman machine` section 2's Compose
path already uses, via `KIND_EXPERIMENTAL_PROVIDER=podman`), and has been
uninstalled from this machine (GitHub issue #541, D93) — live-verified
first: full stack (nodes, all 9 pods, ingress 80/443, and the golden-path
smoke test, 15/15) confirmed healthy with Docker Desktop quit before it
was removed.

## 1. Native dev loop (fastest — no containers for api/web)

`api`/`web` run directly on the host. **Postgres, OpenSearch, Mailpit,
and Redpanda all live in kind only** (D24/D26/D29/D53 in
`docs/DECISIONS.md`) — reached via port-forward, not
`infra/docker-compose.yml`'s containers (those service definitions stay
in the file as inert reference only). This requires the `kind` cluster
from section 3 to already be up.

```bash
# 1. kind cluster must already exist (section 3) — all four live there
infra/scripts/dev-port-forwards.sh start

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

Stop: `infra/scripts/dev-port-forwards.sh stop`.

**Why a script instead of `kubectl port-forward ... &` directly:** a
plain backgrounded port-forward only survives as long as the shell
that started it — fine in an ordinary terminal, but not in an
AI-assisted dev session, where each tool call can run in a fresh
shell and silently kill anything backgrounded in a previous one (GitHub
issue #312). `infra/scripts/dev-port-forwards.sh` wires all four into
macOS launchd LaunchAgents instead — supervised independently of any
shell, with `KeepAlive` auto-restarting a forward if the underlying
`kubectl port-forward` process ever exits (e.g. a pod restart breaking
the tunnel). `start`/`stop` are both idempotent; `status` reports each
one; logs land in `/tmp/interview-insights-port-forwards/`. Written for
bash 3.2 (macOS's actual default `/bin/bash`, no associative arrays),
matching every other script in `infra/scripts/`.

**Gotcha:** if `infra/docker-compose.yml`'s OpenSearch, Mailpit, or
Redpanda containers happen to also be running, both it (`0.0.0.0` via
Docker) and the port-forward (`127.0.0.1`) can coexist on the same port
and `localhost` becomes ambiguous — the exact silent-wrong-target
problem D24 hit with Postgres.app. Stop the compose container(s)
(`docker stop interview-insights-opensearch-1 interview-insights-mailpit-1 interview-insights-redpanda-1`)
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
# Redpanda needs no knob either, and no env var below — every
# REDPANDA_BROKERS default in this codebase already points at
# localhost:19092, which the port-forward above now serves. Without it,
# domain-events.e2e-spec.ts and verdict-consumer.e2e-spec.ts (the only
# two files that talk to a real broker) fail with KafkaJSConnectionError
# — every other e2e file is unaffected either way.
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/interview_insights_test?schema=public" \
OPENSEARCH_INDEX_PREFIX="e2etest-" \
npm run test:e2e
```

CI (`.github/workflows/ci.yml`) is unaffected by any of this — its `api`
job runs its own fully ephemeral Postgres, OpenSearch, and Mailpit
service containers per run, and the prefix defaults to empty there.

## 2. Full-stack Compose (prod-like images, still no Kubernetes)

Podman is what backs `infra/docker-compose.yml` now (GitHub issue #496,
`docs/DECISIONS.md` D83) — verified directly to honor `depends_on:
condition: service_healthy` and to build both Dockerfiles cleanly. As of
GitHub issue #540/D90, `kind` (section 3) runs on this same `podman
machine` too, rootful (D84/D88) — see the Prerequisites section above.

**One-time setup**: see Prerequisites above — the same `podman machine`
backs this section and section 3, so there's only one to set up.

**Bring it up:**

```bash
cd infra
podman compose -f docker-compose.yml --profile full up -d --build
```

Builds and runs `api`+`web` as containers alongside `postgres`+
`opensearch`+`mailpit`+`redpanda`. Migrations apply automatically on
`api` container start (`api/scripts/entrypoint.js` → `api/Dockerfile`'s
`CMD`) — no manual `prisma migrate deploy` step. Same ports as
section 1. Confirm `api`/`web` actually waited on `postgres`/
`opensearch` reporting healthy (not just running) before starting:

```bash
podman compose -f docker-compose.yml ps
```

Tear down when done (add `--volumes` to also wipe Postgres/OpenSearch/
Redpanda data):

```bash
podman compose -f docker-compose.yml --profile full down
```

**Gotcha: stop section 1's kind port-forwards first.** This compose
file's postgres/opensearch/mailpit publish the exact same host ports
(5432/9200/1025/8025) `infra/scripts/dev-port-forwards.sh` uses — both
can bind at once with no error, and `localhost` becomes ambiguous about
which backend actually answers (the same silent-wrong-target shape D24
hit with Postgres.app, just between kind and this compose path now):

```bash
infra/scripts/dev-port-forwards.sh stop    # restart later with: ... start
```

**Gotcha: a stale Docker Hub credential can produce a misleading
`unauthorized: incorrect username or password` pull failure** instead
of a clean anonymous pull, if Docker Desktop's `credsStore: desktop`
Keychain entry for `docker.io` has gone stale (e.g. after a failed
`podman login`):

```bash
docker logout docker.io   # not `podman logout` -- different auth file, doesn't fix this
```

**Gotcha: Docker Hub's anonymous pull-rate-limit.** Hit repeatedly while
verifying this from a fresh machine, pulling `node:22-slim`/`postgres`/
`redpanda`. Worked around with a `mirror.gcr.io` mirror for the
`docker.io` prefix (Google's public pull-through cache, no account
needed) in the podman machine VM's own `registries.conf`:

```bash
podman machine ssh -- sudo tee /etc/containers/registries.conf <<'EOF'
unqualified-search-registries = ["docker.io"]

[[registry]]
prefix = "docker.io"
location = "mirror.gcr.io"
EOF
```

This does **not** cover `docker.redpanda.com` (a different registry
hostname that turned out to proxy through the same Docker Hub backing
store and rate limit) — if redpanda's pull still fails after this,
it's not a blocker: nothing in this compose file's `api`/`web`
`depends_on` lists redpanda, so the rest of the stack works fine
without it.

## 3. Full Kubernetes deployment on `kind`

**Fast path:** `infra/scripts/bootstrap-kind.sh` (Phase 13 issue #107)
runs every step below (3.1-3.4, plus provisioning/seeding LocalStack
from section 5) in one shot, and is idempotent — safe to re-run against
an already-running cluster; every step either skips or upgrades in
place rather than erroring. Requires `LOCALSTACK_AUTH_TOKEN`,
`ADMIN_PASSWORD_HASH`, `ADMIN_JWT_SECRET`, and `POSTGRES_PASSWORD` set
in the environment first (see sections 5, 5b, and 5d;
`POSTGRES_PASSWORD` added by GitHub issue #466/D77):

```bash
export LOCALSTACK_AUTH_TOKEN="your_token_here"   # put in ~/.zshenv to persist
export ADMIN_PASSWORD_HASH='the bcrypt hash'     # single-quoted, it contains $
export ADMIN_JWT_SECRET="your_jwt_secret_here"
export POSTGRES_PASSWORD="your_postgres_password_here"
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

**Gotcha (now self-healing): `api`/`notification-service` could start
crash-looping hours or days after a clean deploy, with no code change
involved.** Symptom: `kubectl -n interview-insights logs -l app=api`
(or `-l app=notification-service`) shows
`ResourceNotFoundException: Secrets Manager can't find the specified
secret` as the issue #108 gotcha above, but on a cluster that's been
running fine for a while. Root cause: LocalStack's Deployment
(`infra/k8s/base/localstack/08-localstack.yaml`) deliberately has no PVC
— it's a practice/prototype tool, not a source of truth, so its Secrets
Manager/IAM state is `emptyDir`-backed and disappears whenever the
container itself restarts for *any* reason (OOM, node hiccup, `podman
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
kubectl -n interview-insights rollout restart deployment/api deployment/notification-service
kubectl -n interview-insights rollout status deployment/api --timeout=90s
kubectl -n interview-insights rollout status deployment/notification-service --timeout=90s
```

Not fixed with a PVC — that would undo the deliberate "not a source of
truth" tradeoff issue #78 already made for this practice-tier tool. The
init-hook makes the existing "reseed on start" behavior automatic instead
of manual; it doesn't make LocalStack's state durable.

### 3.1 Create an Ingress-ready cluster

A plain `kind create cluster` doesn't route external traffic in — the
Ingress needs `extraPortMappings` + a node label. `KIND_EXPERIMENTAL_PROVIDER=podman`
(GitHub issue #540, D89/D90) runs this against the `podman machine` from
Prerequisites instead of Docker Desktop — `kind`'s own docs mark this
provider experimental, not GA, and it needs the machine to be **rootful**
(D84/D88) or the control-plane node never reaches `Ready`:

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
export KIND_EXPERIMENTAL_PROVIDER=podman
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
podman build -t interview-insights-api:k8s -f api/Dockerfile api
podman build -t interview-insights-web:k8s -f web/Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=http://api.interview-insights.local web
# `kind load docker-image` doesn't work against a podman-built image
# (`localhost/`-prefix naming mismatch, D88/#545) -- `podman save | kind
# load image-archive` gets the bytes onto the node, but a bare manifest
# reference (what every Deployment here uses) still won't resolve to a
# `localhost/`-tagged image -- containerd expands it to
# `docker.io/library/<name>` instead. Re-tag under that prefix first, or
# kubelet just fails an ImagePullBackOff against real Docker Hub (D91):
for img in interview-insights-api:k8s interview-insights-web:k8s; do
  podman tag "$img" "docker.io/library/$img"
  podman save "docker.io/library/$img" | kind load image-archive /dev/stdin --name interview-insights
done
```

### 3.4 Apply the `dev` overlay

Since GitHub issue #466/D76, `dev` requires LocalStack unconditionally —
this same overlay now also creates the `localstack` Deployment and opts
`api`/`notification-service` into fetching their secrets from it. Their
pods will crash-loop with `ResourceNotFoundException` until LocalStack
is seeded (section 5 below) — that's expected on a fresh apply, not a
sign anything went wrong here:

```bash
kubectl apply -k infra/k8s/overlays/dev
kubectl -n interview-insights get pods    # postgres/opensearch/redpanda/localstack/web
                                           # should reach 1/1 Running; api/notification-
                                           # service won't until section 5 is done
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
infra/scripts/dev-port-forwards.sh start   # see section 1 for why not `... &` directly
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
podman build -t interview-insights-api:k8s -f api/Dockerfile api
podman tag interview-insights-api:k8s docker.io/library/interview-insights-api:k8s
podman save docker.io/library/interview-insights-api:k8s | kind load image-archive /dev/stdin --name interview-insights
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

Extends section 3 so `api`/`notification-service` fetch their real
secrets from LocalStack via an assumed IAM role each, instead of a
plaintext k8s `Secret`. As of GitHub issue #99 (`docs/DECISIONS.md`
D23), this is CD's actual deploy target — not just an occasional manual
walkthrough. GitHub issue #466 (D76) later folded this fully into the
`dev` overlay itself: what used to be a separate, structurally opt-in
`dev-localstack` overlay (nothing actually applied plain `dev` in
practice — CD/`bootstrap-kind.sh` already only ever targeted
`dev-localstack`) is now just `dev`'s own behavior, unconditionally.
There is no more plaintext-Secret fallback to opt out into —
`kubectl apply -k infra/k8s/overlays/dev` *always* requires LocalStack
to be seeded (below) before `api`/`notification-service` reach `Ready`.

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
# 2. Apply the overlay — since D76 this always includes LocalStack +
#    opts both api's and notification-service's ConfigMaps in
kubectl apply -k infra/k8s/overlays/dev
kubectl wait --for=condition=ready pod -l app=localstack -n interview-insights --timeout=120s

# 3. Seed every secret api/notification-service need + each service's own
#    IAM role/policy (idempotent — CD reseeds fresh on every run, since
#    LocalStack keeps no state across pod restarts, see the gotcha below)
kubectl -n interview-insights port-forward svc/localstack 4566:4566 &
./infra/aws/seed-localstack.sh

# 4. Restart both to pick up SECRETS_SOURCE=localstack (rebuild first if
#    api/src or services/notification-service/src changed — see section 4)
kubectl -n interview-insights rollout restart deployment/api deployment/notification-service
kubectl -n interview-insights rollout status deployment/api --timeout=90s
kubectl -n interview-insights rollout status deployment/notification-service --timeout=90s
```

Verify it's actually using LocalStack, not just reachable: create a
candidate through the API, then compare the stored `email_hash` in
Postgres against an HMAC computed with the LocalStack-seeded secret
value (`localstack-seeded-secret-change-me` by default) — there is no
plaintext fallback value left to accidentally compare against (GitHub
issue #466 removed it). See `wiki/blog/phase-11-integrated-prototype/
issue-79-secrets-boot-wiring/README.md` for the original worked example
(pre-#466 — the plaintext-comparison step it describes no longer
applies, the LocalStack-fetch behavior does).

**Gotcha: `api`/`notification-service` crash-loop with
`ResourceNotFoundException` after a `podman stop`/`podman start` of the
`kind` node, outside of a CD run.** LocalStack's Deployment has no PVC
by design (it's a practice tool, not a source of truth, see
`infra/k8s/base/localstack/08-localstack.yaml`'s own comment) — its
in-memory secrets/IAM state doesn't survive the pod restarting alongside
the node. A CD run fixes this on its own (step 3 above reseeds
unconditionally); if you need it fixed before the next push, re-run
step 3 by hand against the restarted LocalStack pod, then
`rollout restart deployment/api deployment/notification-service` again.

## 5b. Admin credential rotation (GitHub issue #192, Phase 18; sourcing changed by #466's follow-up, D78)

`ADMIN_PASSWORD_HASH` and `ADMIN_JWT_SECRET` are deliberately **not** in
any git-tracked manifest — `infra/k8s/base/05-api.yaml` has carried no
committed Secret at all for `api` since GitHub issue #466/D76. A "real"
rotated admin credential committed to a manifest would be exactly as
public as the dev-only placeholder it replaced (`bcrypt("dev-only-admin-
password")`, `"dev-only-change-me-too"` — both still fine to use in
`api/.env` for native local dev, which never leaves `localhost`). Both
keys still live in a separate `admin-credentials` Secret, provisioned
imperatively exactly as before — same pattern as `localstack-credentials`/
`LOCALSTACK_AUTH_TOKEN` above (`docs/DECISIONS.md` D23).

**What changed (D78):** `api` no longer reads `admin-credentials`
directly. It fetches `ADMIN_PASSWORD_HASH`/`ADMIN_JWT_SECRET` from
LocalStack Secrets Manager at boot, same as every other secret it reads
(`docs/SECRETS.md` has the full mechanism). `admin-credentials` is now
*also* consumed by **LocalStack's own pod**
(`infra/k8s/base/localstack/08-localstack.yaml`), but only so its
init-hook can self-heal Secrets Manager after an *unplanned* restart —
routine rotation doesn't depend on that at all. The actual thing that
updates Secrets Manager on a deliberate rotation is
`infra/aws/seed-localstack.sh` (the outer script `cd.yml`/
`bootstrap-kind.sh` already run explicitly every deploy), which
re-seeds it directly from whatever `$ADMIN_PASSWORD_HASH`/
`$ADMIN_JWT_SECRET` currently are — no LocalStack pod restart required.
Only `api` needs restarting, to re-fetch the now-updated value.

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

**What CD does on every push:** `cd.yml`'s "Provision admin credentials
secret" step upserts `admin-credentials` from the two repo secrets
first; its "Seed LocalStack secrets + IAM" step (D78 added
`ADMIN_PASSWORD_HASH`/`ADMIN_JWT_SECRET` to that step's own `env:`)
re-seeds Secrets Manager directly from those same values on every run,
regardless of whether LocalStack's pod itself restarted; "Roll out api"
then restarts `api` to pick up the fresh fetch. LocalStack's pod only
needs to restart if its own Deployment *spec* changed (e.g. this
migration's own rollout) — not as part of routine rotation.

**To rotate again later:** repeat the one-time setup with fresh values,
then either push anything that triggers CD, or run these two steps by
hand — re-seed first, then restart `api`:

```bash
kubectl -n interview-insights port-forward svc/localstack 4566:4566 &
LOCALSTACK_ENDPOINT=http://localhost:4566 ./infra/aws/seed-localstack.sh
kubectl -n interview-insights rollout restart deployment/api
kubectl -n interview-insights rollout status deployment/api --timeout=90s
```

The *old* password stops working the moment `api`'s restart completes —
there's no overlap window, matching this project's single-admin,
single-credential scope (`docs/ROADMAP.md` Phase 18).

## 5c. AI moderation triage & auto-approval (GitHub issues #163, #439, #441, #340, Phase 19/32/39)

Three env vars gate this feature, layered — each one is a complete "off"
switch on its own, and all three must be configured for a submission to
ever auto-publish without a human. GitHub issue #340 (D81) moved all
three, and the LLM call itself, from `api` (in-process, synchronous) to
`review-analyzer` (its own async microservice, off Phase 30's event bus) —
`api` no longer reads any of these or calls Anthropic at all; it only
consumes the `verdict_computed` event `review-analyzer` publishes back.

| Var | What it gates | Where it lives | Safe/default value |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | The LLM triage call itself. Empty/unset = `AnalysisService` is a complete no-op — nothing else below ever runs. | Fetched from LocalStack Secrets Manager at boot (D78/D81) — rooted in the `anthropic-credentials` Secret (imperative, never committed), consumed by LocalStack's own pod rather than `review-analyzer` directly (`docs/SECRETS.md` has the mechanism) | unset |
| `AI_MODERATION_AUTO_APPROVE_THRESHOLD` | The confidence cutoff (D71). Unset (or an empty string — see the issue #450 gotcha below) = nothing is ever auto-approve-eligible; triage still runs and publishes an advisory verdict. | `review-analyzer-config` ConfigMap (not a secret) | `""` |
| `AI_AUTO_APPROVAL_ENABLED` | The kill switch (issue #441). Must be exactly `"true"`; anything else = advisory-only regardless of the threshold. | `review-analyzer-config` ConfigMap (not a secret) | `"false"` |

Today, in every environment this project actually runs (local dev,
`kind`), all three are at their disabled defaults — the feature has never
been turned on outside of unit tests. Confirm the live state of the first
one at any time with `gh secret list` (no `ANTHROPIC_API_KEY` row means
disabled everywhere CD deploys); the other two are visible directly in
`infra/k8s/base/11-review-analyzer.yaml`, or via
`kubectl get configmap review-analyzer-config -n interview-insights -o yaml`
against a live cluster (local dev/Docker Compose don't run
`review-analyzer` as a container — see `services/review-analyzer/.env.example`
instead).

**Gotcha fixed by GitHub issue #450:** `AI_MODERATION_AUTO_APPROVE_THRESHOLD=""`
(an explicit empty string, this project's own convention for "disabled"
optional vars) used to silently parse as threshold `0` — `Number('')` is
`0`, not `NaN` — which would have made *every* clean verdict
auto-approve-eligible regardless of confidence the moment
`AI_AUTO_APPROVAL_ENABLED` was flipped on, the opposite of the documented
fail-closed behavior. `getAutoApprovalConfidenceThreshold()` now treats
an empty string the same as truly unset.

### Step 1 — base triage: `ANTHROPIC_API_KEY`

`ANTHROPIC_API_KEY` is rooted in the same never-committed, imperatively-
provisioned `anthropic-credentials` Secret as `ADMIN_PASSWORD_HASH`/
`ADMIN_JWT_SECRET` (5b above). Since D78, and now read by
`review-analyzer` instead of `api` as of D81, it's fetched from LocalStack
Secrets Manager at boot like every other secret this service reads,
rather than reading `anthropic-credentials` directly — see
`docs/SECRETS.md` for the full mechanism (LocalStack's own pod is the one
consuming `anthropic-credentials` now, so its init-hook can reseed the
real value after an unplanned restart). Rotation is the same two-step
shape 5b describes: re-run `infra/aws/seed-localstack.sh` (or push to
trigger CD), then restart `review-analyzer`. Genuinely optional, unlike
`ADMIN_PASSWORD_HASH`/`ADMIN_JWT_SECRET`: an empty/unset key just leaves
`AnalysisService`'s advisory LLM triage disabled — every write still
succeeds normally, `moderationVerdict` simply stays `null` and the
moderation UI shows "analysis pending" rather than a real verdict. This is
also why the bootstrap fetches it via `fetchOptionalSecret`, not the
strict `fetchSecret` every other secret uses (D78) — the Secrets Manager
entry simply not existing is a valid "disabled" result here, not a
failure. It's deliberately *not* seeded as an empty string when unset: AWS
Secrets Manager rejects an empty `SecretString` outright, which broke this
exact rollout once already (see `docs/SECRETS.md`'s gotcha for the full
story) — `interview-insights/anthropic-api-key` is either a real value or
absent entirely, never present-and-empty. `ANTHROPIC_MODEL` is not a
secret — it lives in the plain `review-analyzer-config` ConfigMap.

**Native local dev** (section 1): `review-analyzer` isn't part of the
default `docker compose up` loop or the host-run api/web pair — run it
directly via `cd services/review-analyzer && npm run start:dev`, reading
its own `.env` (copy `services/review-analyzer/.env.example`):
```bash
# services/review-analyzer/.env
ANTHROPIC_API_KEY="sk-ant-..."
ANTHROPIC_MODEL="claude-haiku-4-5"          # required once the key is set — no fallback
```

**Real `kind`/k8s deploy** (section 3+) — one-time setup:
```bash
gh secret set ANTHROPIC_API_KEY   # paste a real Claude API key

# Only needed to apply this manually, outside CD:
export ANTHROPIC_API_KEY="sk-ant-..."
kubectl create secret generic anthropic-credentials \
  --namespace interview-insights \
  --from-literal=ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY"
```

**What CD does on every push** (`cd.yml`'s "Provision AI moderation
secret" step): upserts `anthropic-credentials` from the
`ANTHROPIC_API_KEY` repo secret — an unset repo secret deploys with the
feature disabled, not a failed deploy. `infra/scripts/bootstrap-kind.sh`
does the same, defaulting to an empty value when `ANTHROPIC_API_KEY`
isn't exported locally.

### Step 2 — auto-approval layer: threshold + kill switch (GitHub issues #439, #441, D71)

With triage running (step 1 done), a clean verdict is still only ever
advisory until both of these are set together. Neither is a secret — both
live in `review-analyzer-config` (moved here from `api-config` by D81;
originally added by GitHub issue #450, previously undocumented in any
committed manifest, `.env.example` only):

```bash
# Native local dev — same services/review-analyzer/.env editing as step 1:
AI_MODERATION_AUTO_APPROVE_THRESHOLD="0.9"   # tune empirically, no prescribed starting value (D71)
AI_AUTO_APPROVAL_ENABLED="true"              # must be exactly this string

# Real k8s deploy: edit infra/k8s/base/11-review-analyzer.yaml's
# review-analyzer-config ConfigMap (or a per-overlay patch, e.g.
# infra/k8s/overlays/staging, if only one environment should have it on),
# commit, then either push (CD picks it up) or apply manually:
kubectl apply -k infra/k8s/overlays/<overlay>
kubectl -n interview-insights rollout restart deployment/review-analyzer   # ConfigMap changes don't hot-reload
```

There's no starting threshold value prescribed anywhere in this repo —
D71 is explicit that it should be tuned empirically once real verdict/
confidence data exists in an environment, not guessed here.

### Verifying it's actually live

1. `gh secret list` shows `ANTHROPIC_API_KEY`, and
   `kubectl get configmap review-analyzer-config -n interview-insights -o yaml`
   (or `services/review-analyzer/.env` locally) shows
   `AI_AUTO_APPROVAL_ENABLED: "true"` and a real
   `AI_MODERATION_AUTO_APPROVE_THRESHOLD`.
2. Submit a clean, unremarkable rating through the app. Its
   `moderationVerdict` should show `autoApprovalEligible: true` and its
   `status` should already be `approved` (check via `kubectl exec` psql,
   section 11.5) — with no moderator action in between. This now takes a
   real round-trip: `review-analyzer` computes the verdict and publishes
   `moderation.<type>.verdict_computed.v1`; `api`'s own `VerdictConsumerService`
   (its first event consumer, D81) is what actually stores the verdict and
   calls `approveWithAudit()`.
3. `ai_auto_approval_audit` (GitHub issue #440) has a matching row, and
   `moderation_queue` shows that entry's `reviewed_by` as
   `system:ai-auto-approval`.
4. The reconciliation sweep (GitHub issue #442, moved to `review-analyzer`
   by #340/D81) runs hourly and is silent unless something stalls — check
   `review-analyzer` pod logs for `ReconciliationSweepService` entries if
   a submission seems stuck `pending` with no verdict past 24h; a stall it
   can't resolve publishes a `stalled: true` event, which shows up in
   `api`'s own logs (`VerdictConsumerService`) as a call to
   `ModerationService.flag()`.

## 5d. Postgres credential rotation (GitHub issue #466, D77)

`POSTGRES_PASSWORD` is deliberately **not** in any git-tracked manifest —
`infra/k8s/base/01-postgres-config.yaml` now only carries a
`postgres-config` ConfigMap (`POSTGRES_USER`/`POSTGRES_DB` — not
sensitive, same status as `ADMIN_USERNAME`). The password itself lives in
a separate `postgres-credentials` Secret, provisioned imperatively — same
pattern as `admin-credentials` (5b above), just applied to Postgres
because it needs its credential before any of this project's own code
exists to fetch one from Secrets Manager, ruling out the LocalStack-at-
boot pattern sections 5/5c's secrets use.

**You can pick any value — with two gotchas:**

1. **It must reach `seed-localstack.sh`, not just `postgres-credentials`.**
   `api`/`notification-service` don't read `POSTGRES_PASSWORD` directly —
   they get a `DATABASE_URL` connection string from LocalStack, and
   `seed-localstack.sh` builds that string as `postgresql://postgres:
   ${POSTGRES_PASSWORD:-postgres}@postgres:...` (GitHub issue #466, D77).
   If `$POSTGRES_PASSWORD` isn't set in the environment `seed-localstack.sh`
   itself runs in, it silently falls back to the literal `postgres` —
   `bootstrap-kind.sh` and `cd.yml`'s "Seed LocalStack secrets + IAM" step
   both already export/pass it through for exactly this reason, so this
   is only a risk if you're invoking `seed-localstack.sh` by hand.
   Picking a password and only setting it on `postgres-credentials`
   (without it reaching the seed step too) means Postgres's real
   password and the `DATABASE_URL` api/notification-service fetch go out
   of sync — connections start failing with an auth error, not
   immediately obviously connected to this setting.
2. **It only takes effect on a genuinely fresh Postgres data volume.**
   Postgres only reads `POSTGRES_PASSWORD` during `initdb` (first startup
   against an empty data directory) — changing the Secret's value against
   an *already-initialized* PVC does nothing to the running database's
   real password. See "To rotate again later" below for that case.
   **If you're setting this up for the first time against a cluster that
   already has Postgres data from before this change (when the password
   was the hardcoded `postgres`), keep `POSTGRES_PASSWORD=postgres` for
   now** — that matches what's already `initdb`'d, and this change was
   about not committing the value to git, not about forcing an
   unrelated rotation. Pick a real value only on a fresh cluster, or
   once you've done the `ALTER USER` rotation below.

**One-time setup:**

```bash
NEW_POSTGRES_PASSWORD=$(openssl rand -base64 24)   # or: postgres, if reusing existing data — see above
gh secret set POSTGRES_PASSWORD   # paste NEW_POSTGRES_PASSWORD

# Only needed to apply this manually, outside CD (e.g.
# infra/scripts/bootstrap-kind.sh's own use of this same var):
export POSTGRES_PASSWORD="NEW_POSTGRES_PASSWORD's value"
kubectl create secret generic postgres-credentials \
  --namespace interview-insights \
  --from-literal=POSTGRES_PASSWORD="$POSTGRES_PASSWORD"
```

**What CD does on every push** (`cd.yml`'s "Provision Postgres
credentials secret" step): upserts `postgres-credentials` from the repo
secret, before the overlay apply that (re)creates the Postgres
`StatefulSet`'s pod — same "doesn't hot-reload" ordering requirement
`admin-credentials`/LocalStack's own credential have. The "Seed
LocalStack secrets + IAM" step further down also reads the same repo
secret (gotcha 1 above), so `DATABASE_URL` stays in sync automatically.

**To rotate again later:** changing this password only affects a *new*
Postgres pod's own `initdb` — since GitHub issue #466 doesn't add a
running-Postgres password-change step (out of scope; this project's
Postgres is single-instance local-dev only, D24), rotating it for an
already-initialized data volume needs `ALTER USER postgres WITH
PASSWORD '...'` run directly against the live database first, matching
whatever the new Secret will hold, before restarting anything that reads
it.

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

**Step 3 specifically (the `companies` index) has its own script now,
not just a checklist.** A live sweep found this exact checklist step
had been missed repeatedly across many past verification sessions: the
`companies` OpenSearch index had accumulated 420 documents against only
5 real Postgres rows — 415 orphaned "ghost" companies silently showing
up in every `/search` query. Rather than trust the manual step alone
going forward, `api/scripts/prune-orphaned-company-search-docs.js`
diffs the index against Postgres and bulk-deletes anything with no
matching row:

```bash
cd api
DATABASE_URL=... OPENSEARCH_URL=... npm run prune:orphaned-company-search-docs -- --dry-run
DATABASE_URL=... OPENSEARCH_URL=... npm run prune:orphaned-company-search-docs
```

Run the `--dry-run` form first to see what it would delete. This also
catches up on *past* missed cleanups, not just future ones — run it any
time `/search` looks like it's returning phantom companies. Still not
wired into any automated job: company deletion itself is always a
manual, deliberate test-cleanup action, so pruning its fallout stays
manual and deliberate too.

**The `moderation_queue` index gets the same script now, for the same
reason.** Found live: a moderator's `/moderation/search` category
filter was returning zero matches for a category that genuinely had
pending entries. Root cause: `seed-demo-data-undo.ts`'s search-index
cleanup used to fire one `Promise.all` over every deleted entity — at
real seed-run scale (6.4 below) that's thousands of concurrent
OpenSearch deletes, enough to silently overwhelm a single-node/512MB
OpenSearch and leave orphaned documents behind (the script now batches
these calls, but the backlog it had already created needed cleaning
up). Since `reviewedAt: null` is what actually determines "should still
be indexed" here (not mere row existence, unlike `companies`),
`api/scripts/prune-orphaned-moderation-queue-search-docs.js` diffs the
index against currently-pending `moderation_queue` rows instead:

```bash
cd api
DATABASE_URL=... OPENSEARCH_URL=... npm run prune:orphaned-moderation-queue-search-docs -- --dry-run
DATABASE_URL=... OPENSEARCH_URL=... npm run prune:orphaned-moderation-queue-search-docs
```

### 6.3 Synthetic demo data generator (GitHub issue #164, Phase 19)

`api/scripts/seed-demo-data.ts` populates a lower environment (local
`kind`, or a future staging deployment) with realistic companies,
processes, ratings, and reviews — for demoing/exploring the app without
either an empty cold-start database or hand-entering data one field at
a time. It walks the *real* application paths (`CompaniesService` +
`ModerationService.approve()`, `BulkProcessSubmissionService`,
`RoundTypeFieldOptionsService`) via an in-process NestJS application
context — never raw SQL/Prisma, which is exactly the class of bug a
Phase 5 seed script once caused by bypassing `CompaniesService.create()`'s
OpenSearch indexing.

```bash
cd api
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/interview_insights_test?schema=public" \
npm run seed:demo-data -- --companies=8
```

Refuses to run unless `DATABASE_URL` names `interview_insights_test` —
same class of guard as `assertUsingTestDatabase()` (D36), directly
motivated by this same week's D61 incident (an unguarded e2e run
silently contaminated the dev database). Unlike that guard, an explicit
override is allowed, since seeding a real dev/demo/staging database on
purpose is this script's whole point:

```bash
DATABASE_URL="<a real dev/staging database>" \
npm run seed:demo-data -- --companies=8 --i-know-this-seeds-fake-data
```

Generated data is deliberately uneven on two axes: review-count per
company (some land under the `n=3` shrinkage floor, some well above it
— hard constraint #3's "not enough reviews yet" path gets exercised on
purpose) and moderation outcome (mostly approved, with a real minority
left pending/rejected/flagged, so the moderation queue and `/me`-style
status displays also have non-empty demo data). Every generated round's
`type_metadata` is built from the real seeded/admin-managed
`round_type_field_options` values (`RoundTypeFieldOptionsService`), so
it validates against the same registry check the live write path
enforces. Prints a JSON summary (counts per entity type and moderation
outcome), including a `runId`, when it finishes.

### 6.4 Undoing a seed run (GitHub issue #406, Phase 37)

Every `seed:demo-data` run writes a manifest (`runId`, timestamp,
`--companies` count, and the run's `companyIds`/`candidateIds`) to
`api/scripts/.seed-runs/<runId>.json` (gitignored, local only —
deliberately not a Postgres table, this is dev-tool bookkeeping, not
production schema). `api/scripts/seed-demo-data-undo.ts` reads that
manifest back and reverses the run: same FK-safe deletion order
`MeService.eraseMe()` uses for a single candidate, batched over the
whole run, plus best-effort OpenSearch cleanup and a materialized-view
refresh.

**Against the test database:**

```bash
cd api
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/interview_insights_test?schema=public" \
OPENSEARCH_INDEX_PREFIX="e2etest-" \
npm run seed:demo-data -- --companies=2

npm run seed:demo-data:undo -- --list   # no DB/env needed, just reads local manifests

DATABASE_URL="postgresql://postgres:postgres@localhost:5432/interview_insights_test?schema=public" \
OPENSEARCH_INDEX_PREFIX="e2etest-" \
npm run seed:demo-data:undo -- --run-id=<run-id>   # from the seed output or --list

npm run seed:demo-data:undo -- --list   # confirms "No seed runs recorded."
```

**Against a real dev/staging database** (whatever `DATABASE_URL` your
`.env` points at) — the same `--i-know-this-seeds-fake-data` override
`assertSeedTargetConfirmed()` already requires for seeding applies
identically to undoing:

```bash
cd api
set -a && source .env && set +a

npm run seed:demo-data -- --companies=2 --i-know-this-seeds-fake-data
npm run seed:demo-data:undo -- --list
npm run seed:demo-data:undo -- --run-id=<run-id> --i-know-this-seeds-fake-data
npm run seed:demo-data:undo -- --list
```

`--list` never touches Postgres, OpenSearch, or any admin/JWT
environment variable — it only reads the local manifest files, so it
works with zero config. `--run-id=<id>` does need the full app context
(same as the seed script itself), and deletes the manifest file on
success so a completed undo stops showing up in `--list`.

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
validated the PR: `kubectl kustomize` against every overlay
(`dev`, `staging`, `prod` — `dev-localstack` was folded into `dev`
itself by GitHub issue #466/D76, so it's no longer a separate entry
here) to catch a broken Kustomize edit, and a build-only `docker build`
for both `api/Dockerfile` and `web/Dockerfile` to catch a Dockerfile
regression — both at PR time, on every PR, regardless of whether the
self-hosted runner is ever started. Previously, a broken manifest or
Dockerfile would merge with a green CI check and only fail later, when
the real CD job tried to build/apply it against the live cluster.

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
   - **Pre-flight disk usage gate** (GitHub issue #531) — `df -h /`;
     fails the job immediately with an actionable message if usage is
     at/above 85%, before any build starts. Three incidents (D35, D43,
     issue #530) all cost real time discovering disk pressure only
     several steps later, as a confusing OpenSearch
     `cluster_block_exception` during "Roll out api" — this moves that
     discovery to the first step. Section 11.10 below documents
     `infra/scripts/disk-health-check.sh`, a daily launchd job that
     auto-prunes proactively so this gate ideally never fires.
   - **Build `api` image** — `podman build -f api/Dockerfile`, tagged
     `interview-insights-api:k8s`, with the short commit SHA baked in
     via `--build-arg GIT_SHA` (surfaced later at `GET /health`).
   - **Build `web` image** — `podman build -f web/Dockerfile`, tagged
     `interview-insights-web:k8s`, with `NEXT_PUBLIC_API_URL` passed as
     a build arg — it has to be set at build time, not runtime, per the
     Next.js inlining bug fixed in Phase 7 issue #28.
   - **Build `notification-service` image** — `podman build -f
     services/notification-service/Dockerfile`, tagged
     `interview-insights-notification-service:k8s`, same `--build-arg
     GIT_SHA` pattern as `api` (Phase 31, GitHub issue #334).
   - **Build `review-analyzer` image** — `podman build -f
     services/review-analyzer/Dockerfile`, tagged
     `interview-insights-review-analyzer:k8s`, same `--build-arg GIT_SHA`
     pattern (Phase 32, GitHub issue #339).
   - **Load images into kind** — each image is first `podman tag`ged
     under `docker.io/library/` (D91 — otherwise kubelet's bare-reference
     resolution never matches the `localhost/`-tagged image podman
     actually loaded, and fails an `ImagePullBackOff` against real Docker
     Hub instead), then `podman save <docker.io/library/image> | kind
     load image-archive /dev/stdin --name interview-insights`, one image
     at a time, straight into the cluster's node containers, no registry
     involved. Podman since GitHub issue #540 (D89/D90) — `kind load
     docker-image` doesn't work against a podman-built image
     (`localhost/`-prefix naming mismatch, D88/#545) either.
   - **Ensure the namespace exists** — `kubectl apply -f
     infra/k8s/base/00-namespace.yaml`, idempotent, mostly relevant to a
     truly fresh cluster.
   - **Provision the admin credentials Secret** — upserts
     `admin-credentials` from the `ADMIN_PASSWORD_HASH`/
     `ADMIN_JWT_SECRET` repo secrets, before the overlay below ever
     (re)creates api's Deployment (GitHub issue #192, section 5b) — same
     ordering requirement as the LocalStack step right after this one.
   - **Provision the Postgres credentials Secret** — upserts
     `postgres-credentials` from the `POSTGRES_PASSWORD` repo secret,
     before the overlay below ever (re)creates Postgres's `StatefulSet`
     (GitHub issue #466, D77, section 5d) — same ordering requirement.
   - **Provision the AI moderation Secret** — upserts
     `anthropic-credentials` from the `ANTHROPIC_API_KEY` repo secret
     (genuinely optional — see section 5c).
   - **Provision the LocalStack auth token Secret** — upserts
     `localstack-credentials` from the `LOCALSTACK_AUTH_TOKEN` repo
     secret, before the overlay below ever creates the LocalStack pod
     (GitHub issue #99, `docs/DECISIONS.md` D23).
   - **Apply the `dev` overlay** — `kubectl apply -k
     infra/k8s/overlays/dev` reconciles every manifest (namespace,
     configmaps, all three Deployments/Services, the Ingress, the
     Postgres/OpenSearch/Redpanda/LocalStack StatefulSets/Deployments)
     declaratively. Since GitHub issue #466/D76, this always includes
     LocalStack — there is no separate `dev-localstack` variant anymore.
   - **Wait for LocalStack, then seed it** — `kubectl wait
     --for=condition=ready pod -l app=localstack`, then a backgrounded
     `port-forward` + `infra/aws/seed-localstack.sh` (idempotent — see
     section 5) recreates every secret `api`/`notification-service`
     need plus each service's own IAM role/policy, fresh every run,
     since LocalStack keeps no state across pod restarts.
   - **Roll out `api`** — `kubectl rollout restart deployment/api` (the
     image tag string is unchanged even though its content is new, so a
     restart is what actually forces new pods to pull the freshly-loaded
     image) then `rollout status --timeout=90s` blocks until the new pod
     is `Ready` and the old one is gone.
   - **Roll out `web`** — same restart + status-wait for
     `deployment/web`.
   - **Roll out `notification-service`** — same restart + status-wait
     for `deployment/notification-service`.
7. **Job reports success**, `run.sh --once` exits on its own, and the
   runner goes back to `offline` — expected steady state, not a problem
   (section 7).
8. The new code is live behind the existing Ingress hosts
   (`app.interview-insights.local`, `api.interview-insights.local`) with
   no further manual step. Confirm exactly which commit is live via
   `curl http://api.interview-insights.local/health`'s `version` field.

## 9. Tearing down

```bash
# Compose (sections 1-2)
cd infra && podman compose -f docker-compose.yml --profile full down   # add --volumes to also wipe volumes

# kind cluster (section 3) — stop without losing state, resume later:
podman stop interview-insights-control-plane
podman start interview-insights-control-plane   # resumes exactly where it left off

# kind cluster — fully destroy (irreversible, loses all in-cluster data):
KIND_EXPERIMENTAL_PROVIDER=podman kind delete cluster --name interview-insights

# self-hosted runner (section 7) — nothing to stop if using --once (it
# already exited); Ctrl+C if run without --once
```

## 10. Migrating to a new machine

Everything in this repo is designed to be rebuilt from nothing (Phase 13
issue #108 proved it), which makes a machine migration mostly a matter of
following that same discipline rather than trying to carry over live
state. **Don't try to preserve the running `kind` cluster or the `podman
machine`'s state across a migration** — both are notoriously fragile
across a fresh install, and this repo has a one-shot script built for
exactly this situation.

**What never needs migrating**: GitHub itself (repo, issues, PRs, project
board, milestones), the `LOCALSTACK_AUTH_TOKEN`/`ADMIN_PASSWORD_HASH`/
`ADMIN_JWT_SECRET`/`POSTGRES_PASSWORD` GitHub Actions repo secrets CD
reads, and LocalStack's own secrets/IAM state (ephemeral by design, D25
— it self-seeds on any fresh cluster via its init-hook).

1. **Verify what actually transferred** before doing anything else:

   ```bash
   ls ~/workspace/interview-insights ~/workspace/actions-runner-interview-insights
   cd ~/workspace/interview-insights && git status && git remote -v && git fetch
   ssh -T git@github.com                          # SSH key for pushing
   grep LOCALSTACK_AUTH_TOKEN ~/.zshenv ~/.zshrc   # confirm the line came over (don't print the value)
   ```

2. **Reinstall tooling fresh** — don't trust a migrated `podman machine`:

   ```bash
   brew install podman kind kubectl helm awscli gh k9s
   podman machine init --rootful && podman machine start   # rootful -- D84/D88
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
   export POSTGRES_PASSWORD="..."       # same password
   ./infra/scripts/bootstrap-kind.sh
   ```

   The values are the same ones already in the `ADMIN_PASSWORD_HASH`/
   `ADMIN_JWT_SECRET` (section 5b) and `POSTGRES_PASSWORD` (section 5d)
   GitHub Actions repo secrets — CD itself doesn't need re-configuring,
   only this machine's local bootstrap run does, since
   `bootstrap-kind.sh` reads from the environment rather than from
   GitHub.

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

   infra/scripts/dev-port-forwards.sh start
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

## 11. Self-triage playbook — common `gh`/`kubectl`/`podman` commands

Every command below has actually been run, more than once, across this
project's AI-assisted sessions — this section exists so a human
developer can run the same commands directly (self-triage) without
needing an assistant to execute anything. Copy-paste as-is; each block
assumes you're in the repo root unless a `cd` is shown. Cross-references
point at the fuller sections/`wiki/github-project-setup.md` where more
depth already exists — this section is a fast-lookup index, not a
replacement for them.

### 11.1 Ship a change: branch → PR → merge

```bash
# 1. Branch (never commit to main directly, docs-only changes included)
git checkout -b <type>/<short-description>   # e.g. fix/123-thing or feature/124-thing

# 2. Commit (see the repo's own recent `git log` for message style)
git add <files>
git commit -m "type: summary

longer explanation if needed

Closes #<issue-number>"

# 3. Push
git push -u origin <branch-name>

# 4. Open the PR — always assign yourself, always a real closing keyword
gh pr create --title "..." --assignee GowthamSiddarth --body "$(cat <<'EOF'
## Summary
- Closes #<issue-number>. <what and why>

## Test plan
- [x] <what you verified>
EOF
)"

# 5. Merge once satisfied (see project_ci_billing_gap memory / CLAUDE.md
#    for the current CI-billing-gap status — local test/build/lint is
#    the real correctness gate while that lasts, not a green CI check)
gh pr merge <pr-number> --merge --delete-branch
```

### 11.2 File/close a GitHub issue (always `--assignee`, see `wiki/github-project-setup.md`)

```bash
gh issue create --title "..." --assignee GowthamSiddarth \
  --milestone "Phase N — ..." \
  --body "$(cat <<'EOF'
## Why
...
## Scope
...
EOF
)"

# Closing happens automatically when a PR with "Closes #N" merges;
# to close directly instead:
gh issue close <issue-number> --comment "Fixed via PR #<pr-number>."
```

Epic/milestone/project-board mechanics (moving an epic to "In
Progress", linking sub-issues, the project's own node/field IDs) are
fully documented in `wiki/github-project-setup.md` — not repeated here.

### 11.3 Check whether a merge to `main` actually deployed cleanly

Every merge to `main` touching `api/**`, `web/**`, or `infra/k8s/**`
triggers CD on the self-hosted runner (section 8). After merging:

```bash
# List recent CD runs — find the one for your merge
gh run list --workflow=cd.yml --limit 5

# Watch it live (blocks until done; exits non-zero if the run failed)
gh run watch <run-id> --exit-status

# If it failed, get exactly which step and why
gh run view <run-id> --log-failed

# Confirm the live app actually picked up your commit
curl -s http://api.interview-insights.local/health
# {"status":"ok","version":"<should match your merge commit SHA>"}
```

**A real gotcha, hit live (GitHub issue #393):** a `gh run watch`
call's own background/notification summary can say a run
"completed" without that meaning it *succeeded* — always check the
run's actual conclusion (`gh run view <id> --json conclusion` or just
read the `--log-failed` output) rather than trusting a one-line status
summary at face value, especially for anything reported asynchronously.

### 11.4 A CD deploy failed — find out why on the live cluster

```bash
# Is the new pod even coming up?
kubectl -n interview-insights get pods -l app=api
kubectl -n interview-insights get pods -l app=web

# Crash-looping? Read the PREVIOUS container's logs, not the current
# one (it's usually already restarting when you look):
kubectl -n interview-insights logs <pod-name> --previous

# Rollout stuck mid-way:
kubectl -n interview-insights rollout status deployment/api
kubectl -n interview-insights rollout history deployment/api
```

A rolling-update strategy (this project's default) keeps the previous
healthy pod serving traffic while a new one fails — check `get pods`
for a still-`Running` old pod before assuming an outage. See D35,
D40, D43, D60, D63 in `docs/DECISIONS.md` for past incidents diagnosed
exactly this way.

### 11.5 Ad hoc SQL/OpenSearch queries against the live cluster

**Always double-check which database first** — `interview_insights`
(real dev data, 7 companies as of Phase 35) vs. `interview_insights_test`
(disposable, routinely truncated, D24). Running anything destructive
against the wrong one is exactly what D61 documents.

```bash
# Postgres — ad hoc query
kubectl -n interview-insights exec postgres-0 -- psql -U postgres -d interview_insights -c "SELECT count(*) FROM companies;"

# OpenSearch — from a machine with the port-forward running (section 1)
curl -s "http://localhost:9200/companies/_count"
curl -s "http://localhost:9200/companies/_search?q=name:SomeCompany"
```

### 11.6 Clean up the test database when it's overdue for truncation (D24, D61)

`interview_insights_test` accumulates rows from every e2e/smoke run
that doesn't clean up after itself — it's disposable by design, but
"disposable" isn't the same as "self-cleaning." A live check found
3,435 stale companies once (D61); if `npm run test:e2e` starts feeling
oddly slow or a test that reasons about "any RoundType with zero data"
starts failing for no obvious reason, it's usually this.

```bash
kubectl -n interview-insights exec postgres-0 -- psql -U postgres -d interview_insights_test -c "
TRUNCATE TABLE
  moderation_queue,
  round_ratings,
  recruiter_ratings,
  overall_reviews,
  rounds,
  recruiter_interactions,
  recruiters,
  interview_processes,
  candidate_verification_tokens,
  candidates,
  companies
CASCADE;
"
# NEVER truncate round_type_field_options — that's seeded admin/reference
# data (Phase 24/27), not disposable test output.

# Matching OpenSearch cleanup (D26 — these indices are safe to delete anytime):
curl -s -X DELETE "http://localhost:9200/e2etest-*"
```

### 11.7 Full regression check before merging (the real gate during the CI billing gap)

```bash
cd api
npm test                                    # unit
npm run build
npm run lint

# e2e — BOTH env vars required or you risk contaminating the dev
# database/real OpenSearch indices (this exact mistake happened once,
# D61) — a jest globalSetup now refuses to run without them, but don't
# rely on that alone:
set -a && source .env && set +a
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/interview_insights_test?schema=public" \
OPENSEARCH_INDEX_PREFIX="e2etest-" \
npm run test:e2e

# smoke test (opt-in, full golden path in one pass — section 6.1)
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/interview_insights_test?schema=public" \
OPENSEARCH_INDEX_PREFIX="e2etest-" \
MAIL_HTTP_URL="http://localhost:8025" \
npm run smoke:e2e

cd ../web
npm test
npm run build
npm run lint
```

### 11.8 Build and inspect an image directly (diagnosing a bad build, e.g. D63)

Useful when a container crash-loops with a `MODULE_NOT_FOUND` or
similarly path-shaped error — confirm what's actually inside the image
rather than guessing from the build log. Podman since GitHub issue #540
(D90):

```bash
cd /path/to/interview-insights
podman build -t interview-insights-api:debug -f api/Dockerfile \
  --build-arg GIT_SHA=debug api

# Inspect the built image's filesystem directly
podman run --rm interview-insights-api:debug sh -c "ls /app/dist | head -20"
podman run --rm interview-insights-api:debug sh -c "ls /app/dist/main.js"

# Clean up the debug tag when done
podman rmi interview-insights-api:debug
```

### 11.9 Manual live-verification data cleanup checklist

Already covered in full in section 6.2 above (gather ids first,
`moderation_queue` cleanup, the `companies` OpenSearch document-id-is-
a-UUID-not-a-slug gotcha, and `prune-orphaned-company-search-docs.js`)
— linked here so this playbook is a complete index of "where do I look
when X happens."

### 11.10 Daily disk health-check job (launchd, GitHub issue #532)

Proactive counterpart to section 11's "Pre-flight disk usage gate"
bullet above and to `cd.yml`'s own post-deploy prune steps (D35, D43,
issue #530) — a macOS launchd LaunchAgent, same mechanism as
`infra/scripts/dev-port-forwards.sh` (issue #312), that runs daily
(08:00 local) even on days with no CD run, so pressure is caught
between deploys instead of during one.

```bash
# Install (idempotent — safe to re-run)
infra/scripts/disk-health-check.sh install

# Run it once immediately to verify, rather than waiting for 08:00
infra/scripts/disk-health-check.sh run

# Check whether it's installed
infra/scripts/disk-health-check.sh status

# Remove it
infra/scripts/disk-health-check.sh uninstall
```

Logic: checks `df -h /`, `podman system df`, and (best-effort —
skipped if the port-forward from section 1 isn't running)
`curl localhost:9200/_cat/allocation?v`. At/above 70% disk usage, it
runs the same prune commands `cd.yml`'s own steps do — podman since
GitHub issue #540/D90 (`podman image prune`, `podman system prune
--filter until=6h`, `infra/scripts/prune-kind-node-images.sh`). If usage
is still at/above
80% *after* pruning, it fires a local notification (`osascript ...
display notification`) — a single-user dev box doesn't need an
external alerting service, just something that surfaces before the
next CD run hits the 85% pre-flight gate. Logs:
`/tmp/interview-insights-disk-health/health-check.log`.
