# Phase 7, Issue #28 — Base K8s Manifests for `api`, `web`, and Ingress

*Part of Phase 7 — Kubernetes. See `docs/ROADMAP.md` Phase 7.*

Deep-dive by request — Kubernetes Ingress and the Next.js build-time env
var issue this uncovered are both concepts worth internalizing generally,
not just for this project.

## Why this came first

Issue #27 got Postgres and OpenSearch running in-cluster, reachable by
stable Service DNS names. Issue #28 is where the application layer joins
them — `api` and `web` as real Deployments, and, for the first time in
this project, a Kubernetes **Ingress**: the piece that lets traffic from
outside the cluster reach a Service inside it at all.

## Core concept: what an Ingress actually is, and why it needs a controller

A Kubernetes `Service` of type `ClusterIP` (the default, and what `api`/
`web` use here) is only reachable *from inside* the cluster — nothing
external can hit it directly. An **Ingress** resource describes routing
rules (which incoming hostname/path should reach which Service), but an
Ingress resource by itself does *nothing* — it's inert configuration.
Something has to actually watch Ingress resources and program a real
reverse proxy to implement them: an **Ingress controller**
(this project uses `ingress-nginx`, the most common choice). Without a
controller running in the cluster, creating an Ingress resource has zero
effect — a genuinely common first-time-Kubernetes confusion, worth
stating explicitly.

On a real cloud-managed cluster, an Ingress controller typically
provisions a cloud load balancer automatically. On `kind` (a local
cluster running entirely inside Docker), there's no cloud load balancer
to provision — so `kind` needs a specific setup to make an Ingress
controller's ports actually reachable from the host machine at all: the
cluster's node has to be created with `extraPortMappings` forwarding
host ports 80/443 into the node, and the ingress-nginx pods have to be
scheduled specifically onto a node labeled `ingress-ready=true`:

```yaml
# kind cluster config
nodes:
  - role: control-plane
    kubeadmConfigPatches:
      - |
        kind: InitConfiguration
        nodeRegistration:
          kubeletExtraArgs:
            node-labels: "ingress-ready=true"
    extraPortMappings:
      - { containerPort: 80, hostPort: 80 }
      - { containerPort: 443, hostPort: 443 }
```

This had a real, concrete consequence during this issue: the *first*
`kind` cluster created for issue #27 was a plain one, without this
config — and Ingress traffic simply never reached it. The fix was to
delete and recreate the cluster with the ingress-ready config above, then
reapply issue #27's manifests on top. **The general lesson for anyone
setting up `kind` for the first time: decide up front whether you'll ever
need Ingress, since retrofitting it onto an already-running cluster means
recreating the cluster, not just adding a resource.**

## Design choice: host-based routing over path-based routing

With one Ingress resource, this project routes two different hostnames to
two different Services — `app.interview-insights.local` → `web`,
`api.interview-insights.local` → `api` — rather than one shared hostname
split by path (e.g. `/` → web, `/api` → api):

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
spec:
  ingressClassName: nginx
  rules:
    - host: app.interview-insights.local
      http: { paths: [{ path: /, pathType: Prefix, backend: { service: { name: web, port: { number: 3000 } } } }] }
    - host: api.interview-insights.local
      http: { paths: [{ path: /, pathType: Prefix, backend: { service: { name: api, port: { number: 3001 } } } }] }
```

Path-based routing under one host would have needed an nginx
`rewrite-target` annotation to strip a shared `/api` prefix before
forwarding to the `api` Service (since this project's NestJS routes
aren't themselves prefixed with `/api`) — an extra moving part. Host-based
routing sidesteps that entirely, and, just as importantly, keeps
`NEXT_PUBLIC_API_URL` a **plain origin** (`http://api.interview-insights.
local`) rather than a base-path-aware URL the frontend code would need to
account for. **General lesson: when a frontend and its API are both
behind the same Ingress, host-based routing is usually the simpler
default — reach for path-based routing only when you have a specific
reason (e.g. a single public hostname requirement) that outweighs the
added rewrite complexity.**

## The real bug this issue found: `NEXT_PUBLIC_API_URL` was never actually working

This is the most broadly important lesson in this entire post, and it
predates this issue — it was a latent bug since Phase 6's issue #17,
only surfaced because issue #28 needed the API reachable at a hostname
other than `localhost:3001` for the first time.

**Next.js inlines `NEXT_PUBLIC_*` environment variables into the client
JavaScript bundle at *build* time**, not at container start time. This is
a deliberate Next.js design choice (client-side code can't read
server-side-only env vars at runtime, so anything the browser needs has
to be baked in when the bundle is compiled) — but it means setting
`NEXT_PUBLIC_API_URL` under Docker Compose's `environment:` key (a
*runtime* container setting) has **no effect whatsoever** on an
already-built image. `infra/docker-compose.yml`'s full profile had been
doing exactly that since issue #17, and it appeared to work purely by
coincidence: the image had been built with `NEXT_PUBLIC_API_URL`
undefined, and `web/src/lib/api.ts`'s hardcoded fallback
(`'http://localhost:3001'`) happened to be the exact same value the
(ineffective) runtime setting was trying to set.

The moment issue #28 needed the frontend to call
`http://api.interview-insights.local` instead, that coincidence broke,
and the bug became visible. The fix: promote `NEXT_PUBLIC_API_URL` to a
Docker build **`ARG`**, set at image-build time, not container-run time:

```dockerfile
# web/Dockerfile
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build   # bakes the value into the client bundle right here
```

```bash
docker build -t interview-insights-web:k8s -f web/Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=http://api.interview-insights.local web
```

And `infra/docker-compose.yml`'s full profile moved the same setting from
`environment:` to `build.args:`, fixing the exact same latent bug there
too, not just for the new Kubernetes path.

**The general, widely-applicable lesson**: any framework or tool that
distinguishes *build-time* configuration from *runtime* configuration
(Next.js's `NEXT_PUBLIC_*` vars are one instance of a much broader
pattern — bundlers baking in `process.env` values, compiled feature
flags, anything embedded into a static asset before it's served) will
silently ignore a runtime environment variable set after that build
already happened. **A config value that "happens to work" is worth
actively suspecting, not just accepting** — the way to find out whether
a setting is actually taking effect, versus merely coinciding with a
fallback default, is to deliberately change the environment enough that
the fallback and the intended value diverge, exactly what happened here
by pure necessity once a non-`localhost` API host was needed.

## Step-by-step: what actually got built

1. **Wrote `05-api.yaml`** — a `ConfigMap` for non-secret env
   (`CORS_ORIGIN`, `OPENSEARCH_URL` pointed at issue #27's Service DNS),
   a `Secret` for `DATABASE_URL`/`EMAIL_HASH_SECRET` (duplicating issue
   #27's Postgres credentials as one connection string — Kubernetes has
   no native way to compose an env var from several Secret keys, and a
   wrapper script just to avoid that duplication isn't worth it at this
   scale), a `Service`, and a `Deployment` with `/health`-based
   readiness/liveness probes.
2. **Wrote `06-web.yaml`** — a `Service` and `Deployment`, deliberately
   with *no* env vars at all (there's nothing for a runtime env var to
   do, per the bug above — the correct value is already baked into the
   image).
3. **Wrote `07-ingress.yaml`** — the two-host routing rule described
   above.
4. **Fixed `web/Dockerfile`** to accept `NEXT_PUBLIC_API_URL` as a build
   `ARG`, and moved `infra/docker-compose.yml`'s full profile to set it
   via `build.args` instead of `environment`.
5. **Recreated the `kind` cluster** with the ingress-ready node config,
   and installed `ingress-nginx`'s kind-specific deploy manifest (which
   already targets `ingress-ready=true` nodes via its own `nodeSelector`).
6. **Built both images directly with `docker build`** (not through
   Compose, since each needed its own `--build-arg` for its own target
   host) and loaded them into the cluster with `kind load docker-image`.
7. **Verified without touching `/etc/hosts`** — used `curl --resolve
   <host>:80:127.0.0.1` for basic connectivity checks, and launched
   Playwright's Chromium with `--host-resolver-rules=MAP <host>
   127.0.0.1` for the full browser-based verification, rather than
   editing a system file just for local testing.
8. **Ran the full golden-path flow through the real Ingress**: create
   company → candidate/process → round → rating (submitted `pending`,
   per CLAUDE.md hard constraint #2) → search finds the company via the
   in-cluster `opensearch` Service — zero console errors, and — the
   detail that specifically proves the CORS/hostname wiring is correct,
   not just "the app loaded" — the browser's actual origin during this
   run was `http://app.interview-insights.local`, matching `api`'s
   `CORS_ORIGIN` exactly, succeeding for a genuinely different reason
   than Phase 2.3's original CORS fix (that one just needed *any*
   matching origin configured; this one needed the *specific*
   Ingress-routed origin to be the one actually configured).

## What this enabled

Only issue #29 (Kustomize overlays for dev/staging/prod) remains in Phase
7. The `NEXT_PUBLIC_API_URL` build-arg fix applies to *every* future
deploy target this project ever adds — each one just needs its own image
build with its own `--build-arg`, following the exact template
established here. The host-based Ingress routing pattern, and the
"retrofitting Ingress requires recreating the `kind` cluster" lesson, are
both directly reusable for any future local-Kubernetes-development setup,
on this project or otherwise.
