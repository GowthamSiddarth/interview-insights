# Phase 46, Issue #660 — Container Image Delivery Path to the Pilot VM

*Part of Phase 46 — Hetzner Pilot: Reachability & Operational Hardening.
See `docs/ROADMAP.md` Phase 46, Track A.*

## The gap this closed

`cd.yml`'s existing image-delivery mechanism — `podman save | kind load
image-archive` — only works because CD and the target `kind` cluster
are the same machine. The pilot VM is a genuinely separate machine;
there was no way for a built image to reach it at all before this
issue.

## GHCR, chosen deliberately over a self-hosted registry

A self-hosted registry on the pilot VM itself was considered and
rejected — it would mean adding registry storage, auth, and backup
concerns to a box already running k3s and the full app stack, for a
single-operator pilot that doesn't need that operational surface. GHCR
piggybacks on a vendor relationship this project already trusts
(GitHub itself), with per-repo package permissions that map cleanly
onto this project's existing access model.

## The pull secret and the new credential it introduces

```bash
kubectl create secret docker-registry ghcr-pull-secret \
  --namespace interview-insights \
  --docker-server=ghcr.io \
  --docker-username=GowthamSiddarth \
  --docker-password="$GHCR_PAT" \
  --docker-email=unused@example.com
```

`HETZNER_GHCR_PAT` — a GitHub PAT scoped to `write:packages`/
`read:packages` — does double duty: the same credential authenticates
`docker`/`podman login ghcr.io` on the push side (from CI) and becomes
`ghcr-pull-secret`'s `dockerconfigjson` on the pull side (on the
cluster). CLAUDE.md's hard constraint #6 means no secret this project
provisions is allowed to go undocumented — `docs/SECRETS.md`'s
inventory table gained a new row for it as part of this same issue, not
as a follow-up.

## Verification: a real image, a real pull, not just a config check

```bash
podman tag docker.io/library/alpine:latest "$TEST_IMAGE"
podman push -q "$TEST_IMAGE"

kubectl apply -f - <<POD
apiVersion: v1
kind: Pod
metadata:
  name: ghcr-smoke-test
spec:
  imagePullSecrets: [{name: ghcr-pull-secret}]
  containers: [{name: smoke-test, image: $TEST_IMAGE, command: ["sleep", "30"]}]
POD
kubectl wait --for=condition=Ready pod/ghcr-smoke-test --timeout=60s
```

```
ghcr-smoke-test   1/1     Running   0          3s
PROVEN: pulled ghcr.io/gowthamsiddarth/interview-insights-ghcr-smoke-test:latest via ghcr-pull-secret.
```

A genuinely private image, pushed and pulled through the exact
mechanism `cd-hetzner.yml` (#708) would go on to use for every real
deploy — not a synthetic config-only check, an actual pod reaching
`Running` off a real GHCR pull.
