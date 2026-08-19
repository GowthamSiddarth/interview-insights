# Phase 45, Issue #648 — Deploy `overlays/hetzner-pilot`; Verify Full-Stack Health

*Part of Phase 45 — App-Hosting Pilot on Hetzner. See `docs/ROADMAP.md`
Phase 45.*

## The gap this closed

Every other Phase 45/46 issue built a piece of the pilot — the VM, k3s,
ingress-nginx, TLS, the overlay, the CD workflow. This issue was the
moment all of it actually had to work together, for real, against the
live internet. Its own acceptance bar, stated plainly in the roadmap:
`https://app.interviewinsights.fyi` and
`https://api.interviewinsights.fyi/health` both return a real `200`,
from outside the cluster entirely, with a real trusted TLS handshake —
not `kubectl rollout status` saying "success" and stopping there.

It took six real `cd-hetzner.yml` runs to get there. Each failure was a
genuine bug, fixed and verified before moving to the next attempt — not
retried blind.

## Run 1: `HETZNER_VM_IP` missing

`infra/scripts/hetzner-pilot-tunnel.sh` (#668) discovers the VM's IP via
`terraform output`, which works when a human runs it interactively
(real local Terraform state exists) but not inside `cd-hetzner.yml`'s
own job — `actions/checkout@v4` gives it a fresh checkout with no
`.terraform/` cache or state file (both deliberately gitignored, D101's
local-state-only design). Fixed by adding a `HETZNER_VM_IP` override —
a plain GitHub Actions repo *variable*, not a secret, since it's a
public IP already resolvable via DNS:

```bash
vm_ip() {
  if [ -n "${HETZNER_VM_IP:-}" ]; then
    echo "$HETZNER_VM_IP"
    return
  fi
  (cd "$REPO_ROOT/infra/terraform/hetzner" && terraform output -raw server_ipv4)
}
```

## Run 2: every app pod crash-loops with `exec format error`

Every image built and pushed successfully, but the pilot's pods refused
to start. Root cause: this project's self-hosted CD runner is Apple
Silicon (arm64); the pilot VM is x86_64. `podman build` defaults to the
host architecture, so every image was silently built arm64 — pushed
fine, deployed fine (neither GHCR nor Kubernetes cares about
architecture), and only actually trying to *run* on the VM exposed the
mismatch. Fixed with an explicit `--platform linux/amd64` on all four
builds, verified working via a plain `podman run --rm --platform
linux/amd64 alpine uname -m` smoke test before trusting it for the real
thing.

## The ARM64 detour (D109/D110) and the QEMU segfault (D109/D111, #761)

Adding `--platform linux/amd64` fixed three of the four images —
`api`/`notification-service`/`review-analyzer` all build fine under
cross-arch emulation. `web`'s Next.js/SWC production build didn't:
`qemu: uncaught target signal 11`, a segfault inside SWC's native Rust
compiler, reproducible every time. What followed was a real
architectural fork, documented in full in D109 (every application-level
workaround tried and ruled out — CPU/thread-count tuning, a Babel
fallback blocked outright by `next/font` requiring SWC) and D110 (an
ARM64 VM migration attempt that got as far as *destroying* the existing
VM before discovering Hetzner's ARM64 line isn't actually available in
this pilot's own datacenter — reverted, VM restored). The eventual fix,
D111/#761, moved just `web`'s image build onto a genuinely native
GitHub-hosted runner — see that issue's own post (once Phase 46's blog
qualifies) for the full debugging trail; this post only needed to know
the outcome to keep moving.

## Run 5: SSH host key mismatch, then a bare VM

Once D111's native `web` builder was in place, `cd-hetzner.yml` got
past every image build for the first time — and immediately failed at
"Open SSH tunnel to the pilot k3s API." The D109/D110 VM destroy/
recreate cycle had left a stale `known_hosts` entry behind.
`StrictHostKeyChecking=accept-new` alone doesn't recover from this — it
only auto-trusts a host with *no* existing entry, not a *different*
one, the same MITM-protection logic as strict mode. Fixed by purging
the stale entry before connecting
(`infra/scripts/hetzner-pilot-tunnel.sh`, `ssh-keygen -R "$ip"`) —
found live via this exact run, not anticipated in advance.

Fixing that surfaced the next problem: the D109/D110 restore had
brought the VM back, but a plain `terraform apply` doesn't reinstall
anything that was running *on top of* it.

The D109/D110 restore brought the VM back, but a plain `terraform
apply` doesn't reinstall anything that was running *on top of* it — k3s,
ingress-nginx, cert-manager, and the TLS cert all had to be
reprovisioned from scratch before the tunnel fix even had anything to
connect to. Confirmed via `command -v k3s` returning nothing on the
restored VM, then re-run in the exact order those pieces actually
depend on each other (k3s → ingress-nginx → namespace+GHCR secret →
cert-manager, since the Certificate resource needs the namespace to
already exist).

## Run 6: everything works

```
Set up job: success
Build & push api image: success
Build & push notification-service image: success
Build & push review-analyzer image: success
Open SSH tunnel to the pilot k3s API: success
Roll out api: success
Roll out web: success
Roll out notification-service: success
Roll out review-analyzer: success
```

## Verification, from outside the cluster, not from `kubectl`

```bash
curl -s -o /dev/null -w "app: HTTP %{http_code}\n" https://app.interviewinsights.fyi/
curl -s -o /dev/null -w "api health: HTTP %{http_code}\n" https://api.interviewinsights.fyi/health
```

```
app: HTTP 200
api health: HTTP 200
```

Both real 200s, real trusted TLS, checked from a machine with no special
access to the cluster — the same way any real visitor would reach it.
Five genuine bugs found and fixed to get here, none of them
hypothetical, all of them caught by actually running the thing rather
than trusting an earlier step's "success" in isolation.
