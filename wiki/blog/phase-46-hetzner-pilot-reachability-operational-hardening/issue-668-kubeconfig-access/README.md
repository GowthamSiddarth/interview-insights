# Phase 46, Issue #668 — Kubeconfig and Access Control for the Pilot Cluster

*Part of Phase 46 — Hetzner Pilot: Reachability & Operational Hardening.
See `docs/ROADMAP.md` Phase 46, Track B.*

## The gap this closed

`kind`-based clusters expose their API server on `localhost`,
accessible the moment `kubectl` is configured — there was never a
question of "who can reach this cluster, from where." The pilot's k3s
API server is deliberately never exposed to the public internet (6443
stays closed in the Cloud Firewall, even after #659 opened 80/443) —
this issue is what makes `kubectl`/`helm` against the pilot possible at
all, and defines the actual access model doing so implies.

## Access control model: possession of one SSH key

No separate RBAC, no service account, no token exchange — holding
`~/.ssh/hetzner-vm`'s private key *is* the access control, the same
trust boundary SSH access to the box itself already has. A deliberate
choice matching this project's existing single-operator-scale
precedent (Terraform state stays local-only, for the same reason): a
second access-control layer on top of SSH would be real complexity with
no one else to protect against yet.

## `launchd`, not a plain backgrounded `ssh`

```bash
write_plist() {
  echo '    <string>-N</string>'
  echo '    <string>-o</string><string>StrictHostKeyChecking=accept-new</string>'
  echo '    <string>-L</string>'
  echo '    <string>6443:localhost:6443</string>'
  ...
  echo '  <key>KeepAlive</key><true/>'
}
```

Same reasoning `infra/scripts/dev-port-forwards.sh` already established
for the local `kind` cluster's own port-forwards: a background job
started from an AI-assisted session's own shell reliably dies the
moment that shell tears down. `launchd` supervises the tunnel
independently of any particular terminal session, restarting it if the
underlying SSH connection ever drops.

## A real bug in the original version, found on the first `cd-hetzner.yml` run that reached it

`StrictHostKeyChecking=accept-new` looked sufficient at write time — it
auto-trusts an unknown host, which seemed like exactly what's needed
after the VM gets recreated. It isn't: `accept-new` only trusts a host
with *no* existing `known_hosts` entry. A *different* cached key for
the same IP still gets refused outright, the identical MITM-protection
logic as strict mode — which is exactly what happens every time the VM
is destroyed and recreated (as it genuinely was, twice, during this
same phase's D109/D110 incident) and comes back with a new host key at
the same address. The gap sat unnoticed until the very first real
`cd-hetzner.yml` run that exercised this path after a VM recreation:

```
Host key verification failed.
##[error]Process completed with exit code 255.
```

Fixed by purging the stale entry before connecting:

```bash
ssh-keygen -R "$ip" >/dev/null 2>&1 || true
```

Safe to trust the new key unconditionally — this project provisions the
VM itself via Terraform, so a "new" host key at a known IP is expected
behavior, not a genuine attack signal.

## Verification

Live-tested against the real pilot after the fix — the tunnel connects
cleanly, `KUBECONFIG=~/.kube/hetzner-pilot-tunnel.yaml kubectl get
nodes` returns the pilot's real node. The bug's own discovery, in a
live `cd-hetzner.yml` run rather than a synthetic test, is itself part
of this issue's verification story — it's the reason the fix exists at
all.
