#cloud-config
# Hardening on first boot: dedicated non-root user, SSH key-only auth,
# automatic security updates. Same bar as issue #501's Oracle VM.

users:
  - name: ${admin_username}
    groups: sudo
    shell: /bin/bash
    sudo: "ALL=(ALL) NOPASSWD:ALL"
    ssh_authorized_keys:
      - ${ssh_public_key}

package_update: true
package_upgrade: true
packages:
  - unattended-upgrades
  - fail2ban

write_files:
  - path: /etc/apt/apt.conf.d/20auto-upgrades
    content: |
      APT::Periodic::Update-Package-Lists "1";
      APT::Periodic::Unattended-Upgrade "1";
  # GitHub issue #667 (Phase 46) — Linux/cron equivalent of the self-hosted
  # CD runner's D87 launchd job: same graduated prevent (70%)/warn (80%)
  # shape, adapted for this box's actual tooling (k3s/containerd instead
  # of Docker Desktop) and no GUI to notify from (headless remote VM, so
  # journald + a status file instead of D87's osascript notification).
  - path: /usr/local/bin/disk-health-check.sh
    permissions: '0755'
    content: |
      #!/usr/bin/env bash
      set -euo pipefail

      HARD_THRESHOLD=70
      WARN_THRESHOLD=80
      STATUS_FILE=/var/log/disk-health-check-status
      LOG_TAG=disk-health-check

      usage_pct() {
        df -P / | awk 'NR==2 {gsub("%","",$5); print $5}'
      }

      log() { logger -t "$LOG_TAG" "$1"; }

      PCT=$(usage_pct)
      log "root filesystem at $${PCT}%"

      if [ "$PCT" -ge "$HARD_THRESHOLD" ]; then
        log "at/above $${HARD_THRESHOLD}% - pruning unused k3s/containerd images and vacuuming journal logs"
        # k3s's embedded kubelet already runs its own image GC at 80/85%
        # high/low thresholds by default (containerd's normal behavior) -
        # this is a proactive prune below that, same "prevent, don't just
        # react" reasoning D85/D86/D87 already established for the CD
        # runner's Docker-side equivalent.
        k3s crictl rmi --prune >/dev/null 2>&1 || true
        journalctl --vacuum-size=200M >/dev/null 2>&1 || true
        PCT=$(usage_pct)
        log "after prune: $${PCT}%"
      fi

      if [ "$PCT" -ge "$WARN_THRESHOLD" ]; then
        log "WARNING: still at/above $${WARN_THRESHOLD}% after prune - needs a human look"
        echo "WARN $(date -Iseconds) $${PCT}%" >> "$STATUS_FILE"
      else
        echo "OK $(date -Iseconds) $${PCT}%" >> "$STATUS_FILE"
      fi
  - path: /etc/cron.d/disk-health-check
    content: |
      0 8 * * * root /usr/local/bin/disk-health-check.sh

runcmd:
  # SSH key-only, no root login — the deploy user above already has the
  # same key, so this doesn't lock anyone out.
  - sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
  - sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
  - systemctl restart ssh
  - systemctl enable --now unattended-upgrades
  - systemctl enable --now fail2ban
