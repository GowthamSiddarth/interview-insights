# Interview Insights Platform

Candidates rate their interview experience per-round (difficulty, plus
interviewer traits limited to fluency, clarity, and focus) plus recruiter
interactions, rolled up into company-level analytics. See `CLAUDE.md` and
`docs/` for the full architecture, data model, and decisions log.

Currently implemented: Phases 1-4 (repo scaffold, a Create+Read vertical
slice, trust & moderation, and analytics) plus part of Phase 5 (search).
See `docs/ROADMAP.md` for what's next and `CLAUDE.md`'s "Current status"
for what was last verified working.

## Prerequisites

- Node.js 22+
- Docker — used for Postgres and OpenSearch locally. `api` and `web` run
  directly on the host with npm. If you don't have Docker yet:
  - macOS: `brew install --cask docker`, then open the Docker app once so
    its daemon starts (or install Docker Desktop from
    [docker.com](https://www.docker.com/products/docker-desktop/))
  - Otherwise follow the [Docker Engine install docs](https://docs.docker.com/engine/install/)
    for your OS
- Optional: a Postgres client (DBeaver, TablePlus, `psql`) for poking at the
  database directly

See `wiki/deployment-guide.md` for a single, consolidated command-by-
command reference across every environment below (native dev, full
Docker Compose, full Kubernetes on `kind`, and the Phase 11 LocalStack
secrets/IAM integration) — this section covers the same ground with
more explanation, that one is just the commands in order.

## Quick start

**1. Start Postgres + OpenSearch + Mailpit**

All three now live in the `kind` cluster only, not Docker Compose (see
`docs/DECISIONS.md` D24/D26/D29) — this requires the `kind` cluster from
`wiki/deployment-guide.md` section 3 to already be up:

```bash
kubectl -n interview-insights port-forward svc/postgres 5432:5432 &
kubectl -n interview-insights port-forward svc/opensearch 9200:9200 &
kubectl -n interview-insights port-forward svc/mailpit 1025:1025 8025:8025 &
```

`infra/docker-compose.yml`'s service definitions stay in the repo as
documented reference only — nothing should point at them day to day
(and don't run its OpenSearch/Mailpit alongside the port-forwards: both
can bind the same ports at once and `localhost` becomes ambiguous about
which instance you're talking to).

**2. Set up and run the API**

```bash
cd api
cp .env.example .env        # defaults already match the compose Postgres above
npm install
npx prisma migrate deploy   # applies api/prisma/migrations against the DB
npm run start:dev           # http://localhost:3001, watches for changes
```

Confirm it's up: `curl http://localhost:3001/health` → `{"status":"ok"}`

**3. Set up and run the web app** (separate terminal)

```bash
cd web
cp .env.example .env.local  # Next.js convention — NOT .env
npm install
npm run dev                 # http://localhost:3000
```

**4. Use it**

Open `http://localhost:3000`, click **Log in** in the nav (magic-link —
no password: enter an email, then open the link from Mailpit at
`http://localhost:8025`), and walk through the flow: create a company →
start an interview process (role + outcome — the candidate comes from
your session now, not a form field) → add a round → submit a rating. The
rating will show as `pending` — every rating/review is moderation-gated
before it's public (see `docs/DECISIONS.md` D3), and there's no
moderation worker yet (Phase 3), so the public ratings count stays at `0`
by design.

**Stopping/resetting:** `docker compose down` stops Postgres and OpenSearch
(data persists in named volumes). Add `-v` to also wipe the data and start
fresh next time.

### Alternative: full-stack Docker Compose

For prod-like local testing of the actual `api`/`web` Docker images
(rather than the fast host-based loop above):

```bash
cd infra
docker compose --profile full up --build
```

This builds and runs `api` and `web` as containers alongside `postgres`.
Migrations are applied automatically when the `api` container starts (no
manual `prisma migrate deploy` step needed) — see `api/Dockerfile`. Same
ports as the host-based setup: web at `http://localhost:3000`, api at
`http://localhost:3001`.

### Alternative: local Kubernetes (Phase 7)

All of `infra/k8s/base/` (Postgres, OpenSearch, `api`, `web`, Ingress) runs
against any local cluster — verified with [kind](https://kind.sigs.k8s.io/).
Kustomize overlays live in `infra/k8s/overlays/{dev,staging,prod}/` —
`dev` is the same config as the base (formalized as an overlay), the only
one actually meant to be applied locally; `staging`/`prod` are structural
only (own namespace, real-ish resource values, per-environment Ingress
hosts, distinct image tags) until a real shared cluster exists.

**1. Create a cluster with an Ingress-ready node** (needed for the
`api`/`web` Ingress below — a plain `kind create cluster` won't route
external traffic in):

```bash
brew install kind
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

# ingress-nginx installed via Helm, not raw upstream YAML — it's
# third-party infra distributed as a chart, unlike our own app manifests
# (which stay on Kustomize, see docs/DECISIONS.md D19).
brew install helm
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

**2. Build and load the `api`/`web` images.** Next.js inlines
`NEXT_PUBLIC_API_URL` into the client bundle at *build* time (see
`web/Dockerfile`), so it must be set as a `--build-arg` matching the
Ingress host below — not as a runtime env var (that was a latent bug in
the Docker Compose full profile, fixed alongside this):

```bash
docker build -t interview-insights-api:k8s -f api/Dockerfile api
docker build -t interview-insights-web:k8s -f web/Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=http://api.interview-insights.local web
kind load docker-image interview-insights-api:k8s interview-insights-web:k8s \
  --name interview-insights
```

**3. Provision Postgres's credentials.** Never committed to a manifest
(GitHub issue #466, D77 — see `wiki/deployment-guide.md` section 5d for
the full rotation story); the namespace must exist first:

```bash
kubectl apply -f infra/k8s/base/00-namespace.yaml
kubectl create secret generic postgres-credentials \
  --namespace interview-insights \
  --from-literal=POSTGRES_PASSWORD="pick-a-password"
```

**4. Apply the `dev` overlay.** Since GitHub issue #466/D76 this also
requires LocalStack (`api`/`notification-service` fetch their own
secrets from it at boot) — see "LocalStack in the kind cluster" below;
their pods won't reach `Ready` until that's seeded:

```bash
kubectl apply -k infra/k8s/overlays/dev
kubectl -n interview-insights get pods   # postgres/opensearch/redpanda/web should
                                          # reach 1/1 Running; api/notification-service
                                          # need LocalStack seeded first (below)
```

(`kubectl kustomize infra/k8s/overlays/staging` / `.../prod` also build
cleanly, for inspection — neither is meant to be applied against this
local cluster.)

**5. Reach it.** The Ingress routes two hostnames
(`app.interview-insights.local` for `web`, `api.interview-insights.local`
for `api`) that don't resolve anywhere by default. Either add both to
`/etc/hosts` pointing at `127.0.0.1`, or — to avoid touching a system file
just for local testing — use `curl --resolve` / a browser launched with a
host-resolver override:

```bash
curl --resolve app.interview-insights.local:80:127.0.0.1 http://app.interview-insights.local/
curl --resolve api.interview-insights.local:80:127.0.0.1 http://api.interview-insights.local/health
```

To reach Postgres/OpenSearch/Mailpit directly (e.g. for a DB client, or
to read a magic-link email in Mailpit's web UI at `localhost:8025`),
port-forward the same way as the Docker Compose setup:

```bash
kubectl -n interview-insights port-forward svc/postgres 5432:5432
kubectl -n interview-insights port-forward svc/opensearch 9200:9200
kubectl -n interview-insights port-forward svc/mailpit 1025:1025 8025:8025
```

Tear down with `kind delete cluster --name interview-insights`.

### Alternative: LocalStack for IAM/Secrets Manager practice (Phase 10)

Local, free-tier practice for AWS-shaped IAM/Secrets Manager integration
(GitHub issue #66) — not part of the default dev loop, and not used by
any actually-deployed code path (see `docs/DECISIONS.md` D20).

**1. Get a free LocalStack account and auth token** at
[app.localstack.cloud](https://app.localstack.cloud) — as of a 2026
packaging change, even the free/non-commercial tier requires this just
to start the container. Set it in your shell profile (not committed
anywhere):

```bash
echo 'export LOCALSTACK_AUTH_TOKEN="your_token_here"' >> ~/.zshenv
source ~/.zshenv
```

**2. Start LocalStack** (only the two services this phase needs):

```bash
cd infra
docker compose --profile localstack up -d localstack
```

**3. Validate the IAM policy** — `infra/aws/api-secrets-access-policy.json`
scopes `api`'s eventual secrets-reading role to exactly
`secretsmanager:GetSecretValue` on two named secrets, nothing broader:

```bash
brew install awscli
bash infra/aws/verify-iam-policy.sh
```

(LocalStack's IAM policy *simulation* isn't reliably emulated — the
script combines a real `create-policy` call, which proves the JSON is
syntactically valid, with a structural check for the semantic
properties simulation would otherwise verify. See D20 for what was
actually tried first.)

**4. Run `SecretsProvider`'s real integration test** against LocalStack
(skips gracefully if `AWS_ENDPOINT_URL` isn't set):

```bash
cd api
AWS_ENDPOINT_URL=http://localhost:4566 npm run test:e2e -- secrets-provider
```

### LocalStack in the kind cluster (Phase 11)

Extends the practice above into the actually-running `kind` cluster —
`api`'s and `notification-service`'s pods fetch their real secrets from
this instance via an assumed IAM role each, instead of a plaintext k8s
`Secret` (GitHub issue #79, extended to every remaining secret plus
`notification-service`'s own role by GitHub issue #466/D76).
`infra/k8s/base/localstack/` isn't in `infra/k8s/base/kustomization.yaml`'s
resources list, but the `dev` overlay itself now composes it in
unconditionally — there is no more separate opt-in `dev-localstack`
overlay to apply instead; every `kubectl apply -k infra/k8s/overlays/dev`
requires LocalStack to be seeded (step 3 below) before `api`/
`notification-service` reach `Ready`.

**1. Create the auth-token Secret** (same token as above, never committed):

```bash
kubectl create secret generic localstack-credentials \
  --namespace interview-insights \
  --from-literal=LOCALSTACK_AUTH_TOKEN="$LOCALSTACK_AUTH_TOKEN"
```

**2. Apply the `dev` overlay** — includes LocalStack + both services'
ConfigMap patches:

```bash
kubectl apply -k infra/k8s/overlays/dev
kubectl wait --for=condition=ready pod -l app=localstack -n interview-insights --timeout=120s
```

**3. Seed it** — every secret `api`/`notification-service` need, plus
each service's own IAM role with its own `infra/aws/
*-secrets-access-policy.json` attached (idempotent, safe to re-run):

```bash
kubectl -n interview-insights port-forward svc/localstack 4566:4566 &
./infra/aws/seed-localstack.sh
```

**4. Restart `api`/`notification-service`** to pick up the new
`SECRETS_SOURCE=localstack` ConfigMap value (`envFrom` doesn't
hot-reload) and rebuild/reload their images first if you've changed
`api/src` or `services/notification-service/src`:

```bash
kubectl -n interview-insights rollout restart deployment/api deployment/notification-service
kubectl -n interview-insights rollout status deployment/api --timeout=90s
kubectl -n interview-insights rollout status deployment/notification-service --timeout=90s
```

## Connecting a database client (DBeaver, etc.)

With the port-forward from "Quick start" step 1 running (Postgres lives in
`kind`, not Docker Compose — see `docs/DECISIONS.md` D24), connect using:

| Field    | Value                |
| -------- | -------------------- |
| Host     | `localhost`          |
| Port     | `5432`               |
| Database | `interview_insights` |
| Username | `postgres`           |
| Password | whatever you set `POSTGRES_PASSWORD` to when provisioning `postgres-credentials` above (GitHub issue #466, D77 — no longer a fixed committed value) |

## Running tests

```bash
# api — unit tests (no DB needed)
cd api && npm test

# api — integration/e2e tests: needs all three port-forwards above, with
# two isolation knobs so test runs never litter the real data (a separate
# interview_insights_test Postgres database, and an OpenSearch index
# prefix — see docs/DECISIONS.md D24/D26 and wiki/deployment-guide.md
# section 1). Mailpit needs no such knob — mail.e2e-spec.ts uses a unique
# marker per run instead, since there's no database/index concept to
# isolate against:
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/interview_insights_test?schema=public" \
OPENSEARCH_INDEX_PREFIX="e2etest-" \
npm run test:e2e

# web — unit tests
cd web && npm test
```

CI (`.github/workflows/ci.yml`) runs lint, build, and both test suites for
`api`, `web`, and `workers` on every PR against its own fully ephemeral
Postgres service container — entirely unrelated to local dev or `kind`,
unaffected by D24.

## API endpoints

| Method | Path                                                 | Notes                                                   |
| ------ | ---------------------------------------------------- | ------------------------------------------------------- |
| GET    | `/health`                                            | DB connectivity check + deployed `version` (git SHA)    |
| GET    | `/candidates/:id`                                    |                                                         |
| POST   | `/auth/request-link`                                 | Phase 16 — magic-link email; never discloses if known   |
| GET/POST | `/auth/verify`                                     | Consumes the link's token → session + `email_verified`  |
| POST   | `/auth/logout`                                       | Clears the candidate session cookie                     |
| GET    | `/auth/me`                                           | Session check (Phase 16 issue #147, mirrors `/auth/admin/me`) |
| POST   | `/companies`                                         |                                                         |
| GET    | `/companies` / `/companies/:id`                      |                                                         |
| GET    | `/companies/by-slug/:slug`                           | Phase 15 — profile pages address companies by slug      |
| GET    | `/companies/:id/reviews`                             | Approved-only, paginated, Postgres-sourced (D16 note)   |
| GET    | `/companies/:companyId/analytics`                    | Shrinkage-scored aggregates (Phase 4)                   |
| POST   | `/companies/:companyId/processes`                    | Candidate session required (Phase 16 issue #146); candidateId from session |
| POST   | `/companies/:companyId/processes/bulk`               | Phase 25 — whole process tree in one atomic transaction (D49); candidate session required |
| GET    | `/companies/:companyId/processes` / `/processes/:id` |                                                         |
| POST   | `/processes/:processId/rounds`                       |                                                         |
| GET    | `/processes/:processId/rounds`                       |                                                         |
| POST   | `/rounds/:roundId/ratings`                           | Candidate session required (#146); always created as `pending` |
| GET    | `/rounds/:roundId/ratings`                           | Only ever returns `approved` ratings                    |
| POST   | `/processes/:processId/recruiter-interactions`       | Phase 14 — resolves recruiter identity server-side      |
| POST   | `/recruiter-interactions/:id/ratings`                | Candidate session required (#146); always created as `pending` |
| GET    | `/recruiter-interactions/:id/ratings`                | Approved only                                           |
| POST   | `/processes/:processId/overall-review`               | Candidate session required (#146); one per process (schema-enforced); `pending` |
| GET    | `/processes/:processId/overall-review`               | The approved review, or empty                           |
| GET    | `/moderation/queue`                                  | Pending entries, enriched with entity context — admin auth required |
| POST   | `/moderation/queue/:id/{approve,reject,flag}`        | Admin auth required (Phase 18 issue #159)               |
| POST   | `/auth/admin/login`                                  | Sets an httpOnly session cookie; rate-limited            |
| POST   | `/auth/admin/logout`                                 | Clears the session cookie                               |
| GET    | `/auth/admin/me`                                     | Session check for `web`'s `/moderation` gate (#160)      |
| GET    | `/search/companies?q=`                               | OpenSearch-backed (Phase 5)                             |
| GET    | `/search/reviews?q=&companyId=&roleTitle=&...`       | Faceted review search (approved only)                   |

## Project layout

```
api/       NestJS API (Prisma schema + migrations live here)
web/       Next.js + Tailwind frontend
workers/   Background workers (moderation, aggregation) — placeholder, Phase 3+
infra/     docker-compose.yml (Postgres by default, full-stack behind the
           `full` profile — see above), k8s manifests (Phase 7), terraform
           (future)
docs/      Architecture, data model, decisions log, roadmap
```

Read `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, and `docs/DECISIONS.md`
before making structural changes, and see `CLAUDE.md`'s "Current status"
for what was last verified working.
