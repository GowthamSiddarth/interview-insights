#!/bin/bash
set -euo pipefail

# GitHub issue #666 (Phase 46) — deliberate, manual k3s upgrade for the
# pilot. Runs ON the pilot VM. Re-runs the same install invocation #645
# used originally (get.k3s.io is idempotent/self-updating to the latest
# stable release unless INSTALL_K3S_VERSION pins otherwise) — Traefik
# stays disabled, ingress-nginx (#661) is untouched by this.
#
# Not automated: single-node cluster, so an upgrade briefly restarts the
# only replica — worth a human's attention, not a silent unattended
# action. pilot-k3s-check-upgrade.sh (cron, weekly) is what flags that
# one's actually available.

CURRENT=$(k3s --version | head -1 | awk '{print $3}')
echo "Current: $CURRENT"
echo "This restarts k3s on the pilot's single node — brief downtime while it"
echo "restarts (typically well under a minute), during which in-flight"
echo "requests through ingress-nginx will fail."
read -r -p "Proceed with upgrade to the latest stable release? [y/N] " CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
  echo "Aborted."
  exit 1
fi

curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--disable traefik --write-kubeconfig-mode 644" sh -

echo "Waiting for k3s to come back..."
sleep 5
for i in $(seq 1 24); do
  if sudo systemctl is-active --quiet k3s && sudo k3s kubectl get nodes >/dev/null 2>&1; then
    break
  fi
  sleep 5
done

echo ""
k3s --version
sudo k3s kubectl get nodes -o wide
