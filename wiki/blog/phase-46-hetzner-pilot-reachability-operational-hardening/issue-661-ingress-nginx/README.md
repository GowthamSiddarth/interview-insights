# Phase 46, Issue #661 — Install `ingress-nginx` on the k3s Cluster

*Part of Phase 46 — Hetzner Pilot: Reachability & Operational Hardening.
See `docs/ROADMAP.md` Phase 46, Track A, and `docs/DECISIONS.md` D108.*

## The gap this closed

`infra/k8s/base/07-ingress.yaml` already hardcodes
`ingressClassName: nginx` — the same expectation every other
environment (`dev`/`staging`/`prod`'s local `kind` clusters) already
satisfies via `bootstrap-kind.sh`'s own Helm install. #645 disabled
k3s's default Traefik specifically so this issue's own install wouldn't
have to fight it for port 80/443.

## A real, unrelated finding along the way: ingress-nginx is archived

Checking the current release before installing anything (rather than
assuming a version), it turned out `kubernetes/ingress-nginx` had been
archived by its own maintainers on 2026-03-24 — five months before this
work, unnoticed until now. Their own retirement notice: *"If you are
not already using ingress-nginx, you should not be deploying it as it
is not being developed. Instead you should identify a Gateway API
implementation and use it."* No further releases, bugfixes, or security
patches will ever ship.

This mattered more than it might have for a purely local `kind`
cluster: the pilot is the first environment this project has ever run
that's actually on the public internet, so "no future CVE fixes" moved
from a theoretical concern to a live one.

## The decision, made deliberately rather than defaulted into

Presented as a real choice (D108), not decided unilaterally: pin the
final release anyway and keep ingress-nginx everywhere (matching every
other environment, avoiding a new kind of environment-specific drift),
switch to k3s's own Traefik just for the pilot (rejected — diverges
tooling from every other environment for one box), or stop and scope a
full Gateway API migration first (rejected for now — would block
#646/#648/#662 on an unscoped migration). The chosen path: pin to the
final release, and file a real, separate follow-up (#747, under the
Phase 20 ad-hoc-work catch-all epic) to evaluate a project-wide Gateway
API migration properly, rather than let the finding just get dropped.

## Installed via Helm, matching the project's own local-cluster pattern

```bash
helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
  --version 4.15.1 \
  --namespace ingress-nginx --create-namespace \
  --set controller.hostPort.enabled=true \
  --set controller.service.type=ClusterIP \
  --set controller.nodeSelector."kubernetes\.io/os"=linux
```

Chart `4.15.1` pins `appVersion` `1.15.1` — the project's exact final
release. `hostPort`, not a `LoadBalancer`/`NodePort` Service, binds the
controller pod directly to the VM's own 80/443 — the same shape
`bootstrap-kind.sh` already uses locally (there, via `kind`'s
`extraPortMappings`; here, via a real single-node VM), one less moving
part on a box already single-node by definition.

## A real gotcha along the way: helm config ownership

The Helm install had to run as the plain `deploy` user (the kubeconfig
at `/etc/rancher/k3s/k3s.yaml` is world-readable, no `sudo` needed for
`kubectl`/`helm`) — but the very first attempt used `sudo -E helm`,
which preserves `$HOME` while running as root, silently leaving
root-owned files under `deploy`'s own `~/.config/helm/`. Every
subsequent Helm-based issue in this phase (#662's cert-manager
install) hit the same failure until this was caught and fixed with a
one-time `chown -R deploy:deploy ~/.config ~/.cache`.

## Verification

```
pod/ingress-nginx-controller-76c56fff79-mqzmf   1/1   Running   0   16s
HTTP 404
```

The 404 is the correct, expected result — ingress-nginx's own default
backend answering, proof that port 80 genuinely routes to the
controller with zero `Ingress` resources defined yet (those come later,
in #646). A 404 here means success, not a problem.
