# Phase 20, Issue #215 — Prune Stale Docker Artifacts After Every CD Deploy

*Part of Phase 20 — Operational Hardening & Live-Verification Findings.
Filed retroactively after the fact — the incident and fix both happened
before the issue existed. See `docs/ROADMAP.md` Phase 20 and
`docs/DECISIONS.md` D35.*

## Why this matters: an incident on a completely unrelated PR

The PR #208 merge (GDPR erasure, Phase 17 issue #151) triggered `cd.yml`
as usual — and the "Roll out api" step timed out. The new pod
crash-looped instead of becoming ready. Nothing about #208's own code
was wrong; the failure traced back to something several layers removed
from the application entirely.

## Key concept: five days of untouched build artifacts on a persistent runner

`cd.yml`'s "Build api/web image" step produces a new Docker image under
the same `interview-insights-{api,web}:k8s` tag on every run. `kind load
docker-image` retags forward to point at the new build — it never
removes the layers the *previous* build left behind. On a GitHub-hosted
runner this wouldn't matter (a fresh disk every run erases the problem
automatically); on this project's self-hosted, on-demand runner (issue
#88), the same disk accumulates across every single deploy since the
runner was first registered. Five days of that had pushed the shared
Docker Desktop disk to 96% full — 24.6GB of build cache plus a stack of
dangling, untagged images.

## Key concept: the actual crash was two layers removed from disk pressure

Full disk didn't crash the pod directly. It tripped OpenSearch's
flood-stage watermark, which blocks index operations cluster-wide —
and `api`'s `onModuleInit()` tries to create its OpenSearch indices at
every boot. The new pod's very first startup attempt hit
`cluster_block_exception`, an unhandled rejection, and crashed
immediately. `api`/`web` were never actually *down* through any of
this — the old pod kept serving the whole time the new one crash-looped
— but the deploy itself was stuck.

## A costly near-miss, worth documenting as its own lesson

The first cleanup attempt ran `crictl rmi --prune` directly inside the
`kind` node's containerd store. That briefly deleted the image tag
backing the *then-currently-running* `web` Deployment and the live
`ingress-nginx-controller` pod — neither caught by `--prune`'s
"unreferenced" logic, because Kubernetes tracks a running container by
image digest, not by tag, and `crictl` doesn't know a live Pod spec is
still pointing at what it's about to remove. Neither caused an actual
outage (an already-running container keeps running regardless of
whether its image is still tagged) — but either would have failed to
restart from that point forward. Both were rebuilt/re-pulled
immediately, before either pod actually needed to restart.

The real disk hog turned out to be at the *host* Docker Desktop level
— build cache and dangling images from every local `docker build` this
project's history has ever run — not the kind node's own containerd
store specifically. A plain `docker image prune -f` + `docker builder
prune -af` dropped disk usage from 96% to 49% immediately, safely,
because Docker Desktop's content-addressable dedup meant genuinely
unreferenced layers were the actual bulk of it.

## System design approach

`cd.yml` gained a `Prune stale Docker artifacts` step after the two
rollout steps:

```yaml
- name: Prune stale Docker artifacts
  if: always()
  run: |
    docker image prune -f
    docker builder prune -f --filter until=48h
```

`if: always()` matters — a *failed* deploy is exactly the run most
likely to leave extra dangling layers behind (a half-built image, a tag
that never got a successful rollout), so cleanup has to happen
regardless of whether the deploy itself succeeded. The `until=48h`
filter on build-cache pruning keeps roughly the last day or two of
layers for build-speed reuse, rather than forcing every single run back
to a fully cold build — bounding growth to a couple of days' worth
instead of five, not eliminating the cache's benefit entirely.

Deliberately scoped to host-level Docker commands only — never
`crictl`/`ctr` inside the kind node itself, per the near-miss above.
Node-internal image surgery can't see "is this the image a live
Deployment/Pod spec currently points at"; plain host-level pruning
turned out to be both sufficient and safe.

## Step-by-step: what actually got diagnosed and fixed

1. Confirmed the crash signature (`cluster_block_exception`, flood-stage
   watermark) and checked disk usage directly on the kind node: 96%
   full, 2.6GB free of 59GB.
2. Ran `crictl rmi --prune` on the kind node — reclaimed 0 bytes (later
   understood why: the real dangling content lived in Docker Desktop's
   own image/cache store, not primarily the node's containerd content
   store), and this is where the near-miss happened.
3. Rebuilt and re-loaded the two accidentally-untagged images before
   either pod needed to restart from them.
4. Ran `docker image prune -f` + `docker builder prune -af` at the host
   level — disk dropped from 96% to 49% immediately.
5. Cleared OpenSearch's `cluster.blocks.create_index` and
   `index.blocks.read_only_allow_delete` settings directly via its
   `_cluster/settings` API.
6. Retried `kubectl rollout restart` for both `api` and `web` —
   succeeded cleanly this time, confirmed via `api/health`'s `version`
   field matching the actual deployed commit SHA.
7. Added the permanent `cd.yml` step so this doesn't recur, and
   documented the near-miss in `docs/DECISIONS.md` D35 so a future
   cleanup attempt doesn't repeat the node-internal-surgery mistake.

## What this enabled

A CD pipeline that's now self-cleaning rather than silently
accumulating risk run after run — the exact kind of operational debt
that's invisible until it isn't. It also directly motivated issue #216:
having just cleaned up a mess made by ad-hoc verification scripts
pointed at the persistent dev cluster, the next question was how to
make live verification repeatable without creating the same mess again.
