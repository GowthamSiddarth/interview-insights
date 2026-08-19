# Phase 45, Issue #645 — Install k3s on the Hetzner Pilot VM

*Part of Phase 45 — App-Hosting Pilot on Hetzner. See `docs/ROADMAP.md`
Phase 45.*

## The gap this closed

Phase 44 provisioned a hardened Hetzner Cloud VM (CX33, Ubuntu 24.04)
but left it otherwise bare — SSH key-only auth, `unattended-upgrades`,
`fail2ban`, nothing else running. Phase 45's whole point is turning that
bare VM into a real Kubernetes host for this project's existing
`infra/k8s/base` manifests. k3s (not a full `kubeadm` cluster, not
`kind`) was the obvious fit: single binary, single node, genuinely
lightweight — a fair match for a 4 vCPU/8 GB box running the entire
app stack alone.

## Traefik disabled from the start, not removed later

k3s ships with Traefik as its default ingress controller. This project's
`infra/k8s/base/07-ingress.yaml` already hardcodes
`ingressClassName: nginx`, matching every other environment (`dev`/
`staging`/`prod`'s local `kind` clusters, which install `ingress-nginx`
via Helm in `bootstrap-kind.sh`). Rather than let Traefik come up and
tear it down once ingress-nginx installs (#661), the install itself
disables it:

```bash
curl -sfL https://get.k3s.io | \
  INSTALL_K3S_EXEC="--disable traefik --write-kubeconfig-mode 644" sh -
```

`--write-kubeconfig-mode 644` matters too: k3s's default kubeconfig
permissions are root-only, and this project's operational scripts run
`kubectl`/`helm` as the plain `deploy` user (no `sudo`), not root — see
this same phase's #660/#661/#662 posts for why that distinction kept
mattering.

## Access: SSH-tunneled only, 6443 never opens

The pilot's k3s API server is deliberately never exposed to the public
internet — Phase 44's Cloud Firewall only carries port 22 (later 80/443
too, #659). `kubectl` access happens over an SSH tunnel instead
(formalized properly in #668, `infra/scripts/hetzner-pilot-tunnel.sh`),
which this issue's own script anticipated by fetching a local copy of
the kubeconfig with its `server:` field rewritten from the VM's real IP
to `127.0.0.1` — usable the moment a tunnel is open, without editing
anything by hand each time.

## A real gotcha, hit live: the VM's SSH host key changes on every recreation

This VM got destroyed and recreated more than once during Phase 46's own
work (D109/D110 — an ARM64 migration attempt that had to be reverted).
Each time, the box comes back with a genuinely new SSH host key at the
same IP. `StrictHostKeyChecking=accept-new` alone doesn't save you here
— it only auto-trusts a host with *no* existing `known_hosts` entry; a
*different* cached key for the same IP still gets refused, exactly like
strict mode, since that's precisely the signature of a real MITM attack
too. Every reinstall script (this one included) purges the stale entry
first:

```bash
ssh-keygen -R "$VM_IP" >/dev/null 2>&1 || true
```

Safe to trust the new key unconditionally here: this project provisions
the VM itself via Terraform, so a "new" host key at a known IP is
expected, not suspicious.

## Verification

```
NAME                            STATUS   ROLES           VERSION
interview-insights-hetzner-01   Ready    control-plane   v1.36.3+k3s1
```

Node `Ready` within seconds of install, Traefik absent from
`kubectl get pods -A`. This unblocked #661 (ingress-nginx) directly, and
every other Phase 45/46 issue that needs a real cluster to target.
