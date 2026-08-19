# Phase 46, Issue #666 — k3s Upgrade/Patch Cadence for the Pilot VM

*Part of Phase 46 — Hetzner Pilot: Reachability & Operational Hardening.
See `docs/ROADMAP.md` Phase 46, Track B.*

## The gap this closed

Every other piece of this project's infrastructure has an update
story — `unattended-upgrades` for the OS, Dependabot-style discipline
for npm packages. k3s itself had none: nothing watching whether the
pilot was running a stale release, and (being a single-node cluster)
no way to apply one without a real, felt risk to the only replica.

## Check-only by design, not an auto-upgrade

```bash
CURRENT=$(k3s --version | head -1 | awk '{print $3}')
REDIRECT_URL=$(curl -sf -o /dev/null -w '%{redirect_url}' https://update.k3s.io/v1-release/channels/stable)
LATEST="${REDIRECT_URL##*/}"

if [ "$CURRENT" != "$LATEST" ]; then
  logger -t k3s-upgrade-check "upgrade available: $CURRENT -> $LATEST -- run pilot-k3s-upgrade.sh manually to apply"
fi
```

Weekly (Mondays 09:00), log-only. Deliberately not automatic: an
unattended upgrade briefly restarts the only replica this cluster has —
worth a human's attention every time, not something to risk on a
schedule. The actual upgrade is a separate script
(`pilot-k3s-upgrade.sh`), manual and confirmed before running.

## A real bug in the first version, caught on its first live run

The first attempt assumed `update.k3s.io/v1-release/channels/<channel>`
returned a JSON body with a `"latest"` field — a reasonable-looking
assumption that turned out to be wrong. It's actually a plain HTTP 302
redirect straight to the GitHub release tag
(`.../releases/tag/v1.36.3+k3s1`). The JSON-parsing version failed
silently on its very first live run: it hit its own "couldn't
determine latest version" guard, logged nothing, and exited 0 — a
script that looked like it worked, but never actually checked anything.

Caught because the run's log file came back genuinely empty rather than
showing the expected "up to date" line — worth double-checking a
script's own output against what it's supposed to have logged, not just
its exit code. Fixed by reading the redirect target directly instead of
parsing a body that never existed:

```bash
curl -sf -o /dev/null -w '%{redirect_url}' https://update.k3s.io/v1-release/channels/stable
```

## Verification

Re-run live against the real pilot after the fix:

```
up to date (v1.36.3+k3s1)
```

A real, non-empty status line this time — since the VM had installed
that exact release days earlier (#645), "up to date" was the expected,
correct result, and getting it for real (not silently) is what actually
proved the check script works end to end.
