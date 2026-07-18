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

Postgres + OpenSearch in Docker; `api`/`web` run directly on the host.

```bash
cd infra
docker compose up -d                     # postgres:5432, opensearch:9200

cd ../api
cp .env.example .env                     # defaults already match the compose Postgres
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

Stop: `docker compose down` (add `-v` in `infra/` to also wipe data).

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

To reach Postgres/OpenSearch directly (e.g. a DB client):

```bash
kubectl -n interview-insights port-forward svc/postgres 5432:5432
kubectl -n interview-insights port-forward svc/opensearch 9200:9200
```

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

**This is now automated** (`.github/workflows/cd.yml`, GitHub issue #89)
— every one of these exact steps runs on a push to `main` that touches
`api/**`, `web/**`, or `infra/k8s/**`, on the self-hosted runner from
section 7. Since that runner is on-demand, the job just queues until
`./run.sh` is next started — start it whenever a merge should actually
reach the cluster. `GET /health`'s `version` field (the short commit
SHA, baked in at build time via `--build-arg GIT_SHA`) confirms exactly
which commit is live after a deploy — `curl http://api.interview-insights.local/health`.

## 5. LocalStack secrets/IAM integration (Phase 11, opt-in)

Extends section 3 so `api` fetches its real secrets from LocalStack via
an assumed IAM role, instead of the plaintext `api-secrets` k8s
`Secret`. Structurally opt-in — none of this is in the base
`kustomization.yaml` or the plain `dev` overlay (`docs/DECISIONS.md`
D20/D22).

```bash
# 1. Auth token (LocalStack requires one to start, even free tier) —
#    get one at app.localstack.cloud, then:
export LOCALSTACK_AUTH_TOKEN="your_token_here"   # put in ~/.zshenv to persist

kubectl create secret generic localstack-credentials \
  --namespace interview-insights \
  --from-literal=LOCALSTACK_AUTH_TOKEN="$LOCALSTACK_AUTH_TOKEN"

# 2. Apply the overlay that adds LocalStack + opts api's ConfigMap in
kubectl apply -k infra/k8s/overlays/dev-localstack
kubectl wait --for=condition=ready pod -l app=localstack -n interview-insights --timeout=120s

# 3. Seed the two secrets api needs + the IAM role/policy (idempotent)
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
`docker stop`/`docker start` of the `kind` node.** LocalStack's
Deployment has no PVC by design (it's a practice tool, not a source of
truth, see `infra/k8s/base/localstack/08-localstack.yaml`'s own
comment) — its in-memory secrets/IAM state doesn't survive the pod
restarting alongside the node. Fix: re-run step 3 above
(`seed-localstack.sh`) against the restarted LocalStack pod, then
`rollout restart deployment/api` again.

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

## 8. Tearing down

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
