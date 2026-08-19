# Phase 46, Issue #667 — Disk-Usage Monitoring for the Pilot VM

*Part of Phase 46 — Hetzner Pilot: Reachability & Operational Hardening.
See `docs/ROADMAP.md` Phase 46, Track B.*

## The gap this closed

D85/D86/D87 already taught this project a real lesson about disk
pressure on a persistent machine — the self-hosted CD runner's own
launchd disk-health-check job exists precisely because three separate
incidents were each caught only when a deploy actually failed, with
nothing watching disk usage trending toward the failure point in
between. The pilot VM is exactly the same shape of machine (persistent,
running real workloads continuously) and had none of that same
protection.

## Baked into first boot, not a separate install step

```yaml
write_files:
  - path: /usr/local/bin/disk-health-check.sh
    content: |
      HARD_THRESHOLD=70
      WARN_THRESHOLD=80
      PCT=$(df -P / | awk 'NR==2 {gsub("%","",$5); print $5}')
      if [ "$PCT" -ge "$HARD_THRESHOLD" ]; then
        k3s crictl rmi --prune >/dev/null 2>&1 || true
        journalctl --vacuum-size=200M >/dev/null 2>&1 || true
      fi
      if [ "$PCT" -ge "$WARN_THRESHOLD" ]; then
        echo "WARN $(date -Iseconds) $${PCT}%" >> "$STATUS_FILE"
      fi
  - path: /etc/cron.d/disk-health-check
    content: "0 8 * * * root /usr/local/bin/disk-health-check.sh"
```

Added directly to `infra/terraform/hetzner/cloud-init.yaml.tpl` — the
same file that hardens SSH and installs `unattended-upgrades`/`fail2ban`
on first boot. Any VM this project provisions from now on gets disk
monitoring automatically, with no separate script to remember to run.

## Same graduated shape as the CD runner's own job, adapted for what's different here

70%/80% thresholds carried straight over from D87's own calibration —
prevent (auto-prune), then warn if pruning alone didn't clear it. What
changed: `k3s crictl rmi --prune` instead of `docker`/`podman` pruning
(this box runs containerd via k3s, not Docker Desktop), and a log line
+ status file instead of D87's `osascript` notification — this is a
headless remote VM with no GUI session to notify, unlike the CD
runner's own interactive Mac. Deliberately log-only for v1, not yet an
actual alert email — flagged as a natural next step once real SMTP
(#655) exists, not built prematurely for a threshold that's never been
tested against real usage yet.

## Verification

Terraform-level: `terraform validate` and a `terraform console` render
against dummy variables confirmed the embedded script's own `${...}`
Terraform-escaping (`$${...}`) resolved correctly and `bash -n` found
no syntax errors — before ever provisioning a real VM with it. Live
verification happens implicitly the first time any operator SSHes into
a freshly-provisioned VM and confirms
`/etc/cron.d/disk-health-check`/`/usr/local/bin/disk-health-check.sh`
both exist, which has now happened across two separate VM provisionings
(the original, and the restore after the D109/D110 incident).
