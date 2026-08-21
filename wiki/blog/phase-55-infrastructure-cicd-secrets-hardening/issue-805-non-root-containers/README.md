# Phase 55, Issue #805 — Containers Run as Root Everywhere

*Part of Phase 55 — Infrastructure, CI/CD & Secrets Hardening.
See `docs/ROADMAP.md` Phase 55.*

## The gap

None of the four Dockerfiles (`api`, `web`, `notification-service`,
`review-analyzer`) declared a `USER` — every container ran as root by
default, and none of the matching k8s Deployments set a
`securityContext` either. Standard container-hardening practice, and a
real gap: if any of these processes were ever compromised (a dependency
vulnerability, a request-smuggling bug), running as root inside the
container gives an attacker a meaningfully larger set of options than
running as an unprivileged user would.

## The fix: `node:22-slim`'s built-in user, plus a matching k8s `securityContext`

Every one of these images already bases on `node:22-slim`, which ships
a non-root `node` user (uid/gid 1000) out of the box — no new user to
create, just start using the one already there:

```dockerfile
# GitHub issue #805 (Phase 55) — node:22-slim already ships a non-root
# `node` user (uid/gid 1000); nothing here needs root at runtime.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3001
```

`--chown=node:node` on every `COPY` matters as much as the `USER`
line itself — without it, the copied files stay owned by `root` and
the non-root process can't read its own application code. Matching
`securityContext` on every Deployment closes the same gap at the
Kubernetes layer, which can enforce it independently of whatever the
image itself declares:

```yaml
# pod-level
securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  runAsGroup: 1000
# container-level
securityContext:
  allowPrivilegeEscalation: false
  capabilities:
    drop: ["ALL"]
```

`runAsNonRoot: true` is a hard backstop — if an image were ever
accidentally rebuilt without its own `USER node` line, the pod simply
refuses to start rather than silently running as root anyway.
`allowPrivilegeEscalation: false` and dropping every Linux capability
narrow what a compromised process could do even before considering
whether it's running as root or not.

## Verification

Built and ran the `api` image locally via podman as the non-root user
end to end — not just confirming the image *builds*, but that
migrations run and the app actually boots and serves real HTTP traffic
successfully as uid 1000, the scenario most likely to break silently
(a file the app needs to write that only root could touch, for
instance). Every k8s overlay's own e2e/smoke coverage continuing to
pass after the `securityContext` additions confirms the same holds
true in the real deployed environment, not just a local one-off run.
