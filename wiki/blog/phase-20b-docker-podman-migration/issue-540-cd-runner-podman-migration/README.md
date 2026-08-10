# Phase 20b, Issue #540 — Migrating `cd.yml` to Podman, Then Finding Three Things No Spike Ever Reached

*Part of Phase 20b — Docker → Podman Migration. See `docs/ROADMAP.md`
Phase 20b and `docs/DECISIONS.md` D90 and D91.*

## What was actually unblocked

#547 (previous post) closed out the last real question blocking this
issue: kind's podman provider genuinely publishes host ports correctly,
once the test config itself is right. That unblocked #540's own scope —
migrate `cd.yml`, the self-hosted CD runner, and the `bootstrap-kind.sh`
script it depends on, off Docker and onto Podman — but this issue's own
ROADMAP entry went further than "port the code": it explicitly called for
actually running the real `bootstrap-kind.sh` + ingress-nginx flow
end to end, not just another synthetic pod the way every spike before it
had. That distinction is what makes this the pivot post of the whole
phase — it's where "the mechanism works" (#547) turns into "the real
9-pod stack, on the real ports, actually comes up."

## Key concept: the code migration itself is mostly mechanical, once the mechanism is proven

With #547's findings in hand, the actual `cd.yml`/`bootstrap-kind.sh`
changes followed a consistent pattern, applied everywhere Docker had been
assumed:

- Every `docker build` → `podman build`, across all four images (`api`,
  `web`, `notification-service`, `review-analyzer`).
- `kind load docker-image` → the workaround #545/#547 had already
  verified: a per-image `podman save <image> | kind load image-archive
  /dev/stdin` loop.
- `KIND_EXPERIMENTAL_PROVIDER=podman` set at job level, so every
  `kind`-touching step in the workflow talks to the cluster the same way
  every spike in this phase already had.
- `docker image prune`/`docker builder prune` → `podman image prune`/
  `podman system prune --filter until=` — Podman has no separate
  `builder prune` subcommand, so cache pruning folds into `system prune`
  instead.
- `infra/scripts/prune-kind-node-images.sh` and `disk-health-check.sh`'s
  own `docker exec`/`docker system df` calls ported the same way.
- `bootstrap-kind.sh` itself migrated too, even though it wasn't
  literally named in this issue's checklist — it's what creates the
  cluster `cd.yml` deploys into, so `cd.yml` couldn't honestly be
  Docker-free while the cluster it targets was still Docker-created.

One deliberate non-change: the self-hosted CD runner machine itself
(issue #88, Phase 12) needed no code change. It's a persistent macOS box
that just inherits whatever's on its own `PATH` — `podman`/`kind`/
`kubectl`/`helm` already had to be present for every spike in this phase.
Its liveness check did need updating, though: it had hard-coded `docker
info` as its "is this runner correctly configured" probe, which is
exactly what this issue's own "confirm it still works with no docker on
PATH" checklist item is about — swapped for `podman info` plus a `kind
get clusters` check.

## Key concept: a synthetic pod and a real 9-pod stack are different experiments

Every spike before this one — #539, #545, #547 — verified a mechanism
using either a synthetic test pod or a standalone `podman run`, never the
actual `infra/k8s/overlays/dev` stack end to end. That was the right call
for isolating one question at a time, but it meant three real,
reproducible problems were still waiting, entirely unexercised by
anything that came before. Live-running `bootstrap-kind.sh` against the
real cluster surfaced all three.

### Finding 1 — `kind get clusters` silently lies under this Podman/kind version pairing

It shells out to `podman ps -a --filter label=io.x-k8s.kind.cluster
--format '{{index .Labels "io.x-k8s.kind.cluster"}}'` — a Go-template
form that assumes `.Labels` is a map. True for `docker ps`, not true for
this Podman version's `ps` template context, where `.Labels` isn't
indexable that way. The command errors internally with "cannot index
slice/array with type string" — but `kind get clusters` swallows that
error and just reports zero clusters, rather than surfacing it.

That silent failure broke `bootstrap-kind.sh`'s own "already exists,
skip create" check: every re-run believed no cluster existed and tried to
create one that already did, failing outright. The fix sidesteps `kind`'s
own broken enumeration entirely — the existence check now queries `podman
ps` directly (`--filter name=^${CLUSTER_NAME}-control-plane$ --filter
status=running`), which is no worse a coupling to Podman than this script
already had everywhere else post-migration. The exact same failure showed
up a second time, independently: `self-hosted-smoke-test.yml`'s own
`mac-smoke-test` job used `kind get clusters` as its liveness check for
the same reason, and failed identically on a real dispatch — swapped for
`kubectl get nodes` there too, which is what that step actually cares
about anyway.

### Finding 2 — the image-loading workaround is necessary but not sufficient for a real Deployment

Podman canonicalizes any locally built, unqualified image as
`localhost/<name>:<tag>` — exactly the name embedded in the archive
`podman save`/`kind load image-archive` produces. But every manifest in
this repo references images by their bare name
(`interview-insights-api:k8s`, no prefix), and containerd's own
short-name resolution expands *that* to `docker.io/library/<name>:<tag>`,
not `localhost/<name>:<tag>`. The two names never match, so kubelet never
finds the image already sitting in the node's own local store — it
attempts a real Docker Hub pull instead, and fails: `ImagePullBackOff`,
`pull access denied, repository does not exist`.

Every spike before this one used a synthetic pod referencing a
pre-pulled public image (`nginx:alpine`) — never a locally podman-built
image referenced by its bare name, the way every real Deployment here
does. That's exactly why this gap sat unexercised until now. The fix:
`podman tag <image> docker.io/library/<image>` immediately before
`podman save`, wired into `cd.yml`, `bootstrap-kind.sh`, and the manually
run equivalent for `notification-service`/`review-analyzer` (worth
noting: `bootstrap-kind.sh` only ever built `api`/`web` — a pre-existing
scope gap, not introduced by this migration and not fixed here either,
since it's orthogonal to it).

### Finding 3 — Podman's default machine sizing silently starves the control plane

`podman machine`'s own default is 2GB RAM. Docker Desktop's default
allocation had been substantially larger, quietly masking this the whole
time — nothing in any earlier spike ran the full 9-pod stack concurrently
long enough to surface it. The symptom chain, all traced back to this one
root cause: the node container's CPU pinned at roughly 107% continuously
from creation; `podman machine ssh -- free -h` showed only ~376Mi
available out of 1.9Gi; `kube-controller-manager` and `kube-scheduler`
both went `CrashLoopBackOff` — `SIGTERM`, exit 143, resource starvation
making liveness probes time out, not `OOMKilled`/137. That cascaded
further: the `ingress-nginx-admission-create` Job's pod completed, but the
Job resource itself never observed the completion (the job-controller was
unavailable to update it), which left `helm upgrade --install` timing out
against that stuck status.

Sizing the machine to 8GB (`podman machine set --memory 8192`, or
`--memory 8192` on a fresh `init`) resolved every symptom in that chain
immediately, on a clean cluster rebuild — no further control-plane
instability observed. `wiki/deployment-guide.md`'s Prerequisites now
specify this explicitly, rather than relying on Podman's own default and
finding out the hard way.

## Found along the way, deliberately not fixed here

Live-verifying this issue also hit `P1013: invalid port number in
database URL` from `infra/aws/seed-localstack.sh`, which builds
`DATABASE_URL` by directly interpolating `$POSTGRES_PASSWORD` with no
URL-encoding — and `wiki/deployment-guide.md`'s own documented rotation
command can produce `/`, `+`, or `=`, any of which breaks
`postgresql://` parsing. Unblocked in the moment with an `ALTER USER`
rotation to a URL-safe value, but left as a real, pre-existing, unrelated
bug for its own issue rather than folded into this one's scope — a
disciplined "don't fix everything you trip over" call that kept this
issue's diff focused on the migration it was actually about.

## Step-by-step: what actually got migrated and verified

1. Ported every Docker command in `cd.yml`, `bootstrap-kind.sh`, and the
   prune/disk-health scripts to their Podman equivalents.
2. Updated the self-hosted runner's own liveness probe from `docker info`
   to `podman info` + `kind get clusters`.
3. Live-ran the updated `bootstrap-kind.sh` against a real rootful
   `podman machine` — hit and diagnosed Finding 1 (`kind get clusters`),
   fixed it, re-ran.
4. Hit and diagnosed Finding 2 (image tag mismatch) on the next attempt,
   applied the `docker.io/library/` retag fix, re-ran.
5. Hit and diagnosed Finding 3 (2GB machine sizing) once the cluster
   finally started coming up but the control plane destabilized under
   load — resized to 8GB, rebuilt clean.
6. With all three fixed, ran the full stack up and confirmed both
   `app.interview-insights.local` and `api.interview-insights.local`
   reachable over the real ingress-nginx-managed host ports.
7. Confirmed all four app Deployments (`api`, `web`,
   `notification-service`, `review-analyzer`) `Running` with
   podman-built/loaded images — not synthetic ones.
8. Updated `wiki/deployment-guide.md` everywhere it described `kind`/CD
   commands literally.

## What this enabled

**80/443 production parity, confirmed against the real
`infra/k8s/overlays/dev` chart** — not a synthetic pod, not a standalone
mechanism check, the actual stack this project deploys. That closes out
D89's own open caveat for real. `cd.yml`, the self-hosted runner, and
`bootstrap-kind.sh` no longer need Docker present at all. Docker Desktop
itself is still installed on this machine, deliberately — removing it is
explicitly the next post's job, not this one's, since proving the stack
works with it merely *unused* is a different and more conservative claim
than proving it works with Docker Desktop *absent*.
