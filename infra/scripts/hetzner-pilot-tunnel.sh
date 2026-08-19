#!/bin/bash
set -euo pipefail

# GitHub issue #668 (Phase 46) — kubeconfig and access control for the
# Hetzner pilot's k3s cluster: who can `kubectl` against it, from where.
#
# Access control model: the pilot's API server (6443) is deliberately not
# opened in the Cloud Firewall (#659 only opened 22/80/443) — the only way
# in is SSH as the `deploy` user, so "who holds deploy's private key"
# *is* the access control, matching this project's existing single-
# operator-scale precedent (infra/terraform/hetzner/README.md's reasoning
# for keeping Terraform state local-only). No separate RBAC/service
# account is provisioned — one operator, one key, same trust boundary as
# SSH access to the box itself already has.
#
# launchd (not a plain backgrounded `ssh -f -N`), same reasoning as
# infra/scripts/dev-port-forwards.sh: a background job started from an
# AI-assisted session's shell dies the moment that shell tears down.
#
# Usage:
#   infra/scripts/hetzner-pilot-tunnel.sh start    # idempotent
#   infra/scripts/hetzner-pilot-tunnel.sh stop
#   infra/scripts/hetzner-pilot-tunnel.sh restart
#   infra/scripts/hetzner-pilot-tunnel.sh status
#
# Once running: KUBECONFIG=~/.kube/hetzner-pilot-tunnel.yaml kubectl get nodes
#
# Logs: /tmp/interview-insights-hetzner-tunnel/tunnel.log

LABEL="local.interview-insights.hetzner-pilot-tunnel"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="${LAUNCH_AGENTS_DIR}/${LABEL}.plist"
LOG_DIR="/tmp/interview-insights-hetzner-tunnel"
UID_DOMAIN="gui/$(id -u)"

ADMIN_USER="deploy"
SSH_KEY="$HOME/.ssh/hetzner-vm"
KCFG="$HOME/.kube/hetzner-pilot-tunnel.yaml"
SSH_PATH="$(command -v ssh)"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

vm_ip() {
  # HETZNER_VM_IP override exists for cd-hetzner.yml (GitHub issue #708):
  # a CI job's checkout is fresh every run — no .terraform/ cache, no
  # state file (both deliberately gitignored, D101's local-state-only
  # design) — so `terraform output` has nothing to read there. Interactive
  # use (this project's actual operator, with real local state) is
  # unaffected; this env var is normally unset outside CI.
  if [ -n "${HETZNER_VM_IP:-}" ]; then
    echo "$HETZNER_VM_IP"
    return
  fi
  (cd "$REPO_ROOT/infra/terraform/hetzner" && terraform output -raw server_ipv4)
}

write_plist() {
  local ip="$1"
  mkdir -p "$LAUNCH_AGENTS_DIR" "$LOG_DIR"
  {
    echo '<?xml version="1.0" encoding="UTF-8"?>'
    echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
    echo '<plist version="1.0">'
    echo '<dict>'
    echo "  <key>Label</key><string>${LABEL}</string>"
    echo '  <key>ProgramArguments</key>'
    echo '  <array>'
    echo "    <string>${SSH_PATH}</string>"
    echo '    <string>-N</string>'
    echo '    <string>-o</string><string>ExitOnForwardFailure=yes</string>'
    echo '    <string>-o</string><string>ServerAliveInterval=30</string>'
    echo '    <string>-o</string><string>ServerAliveCountMax=3</string>'
    echo '    <string>-o</string><string>StrictHostKeyChecking=accept-new</string>'
    echo '    <string>-o</string><string>IdentitiesOnly=yes</string>'
    echo '    <string>-i</string>'
    echo "    <string>${SSH_KEY}</string>"
    echo '    <string>-L</string>'
    echo '    <string>6443:localhost:6443</string>'
    echo "    <string>${ADMIN_USER}@${ip}</string>"
    echo '  </array>'
    echo '  <key>RunAtLoad</key><true/>'
    echo '  <key>KeepAlive</key><true/>'
    echo "  <key>StandardOutPath</key><string>${LOG_DIR}/tunnel.log</string>"
    echo "  <key>StandardErrorPath</key><string>${LOG_DIR}/tunnel.log</string>"
    echo '</dict>'
    echo '</plist>'
  } > "$PLIST_PATH"
}

refresh_kubeconfig() {
  local ip="$1"
  mkdir -p "$HOME/.kube"
  # StrictHostKeyChecking=accept-new only auto-trusts a host with NO
  # existing known_hosts entry — it still refuses a *different* cached
  # key for the same IP, the same MITM-protection behavior as strict
  # mode. If the VM is ever destroyed and recreated (as it genuinely has
  # been, more than once, during Phase 46 — D109/D110), it gets a new
  # SSH host key at the same IP, and every ssh call here failed outright
  # with "Host key verification failed" until this was purged first —
  # found live via a real cd-hetzner.yml run, not assumed. Safe to trust
  # the new key unconditionally: this project provisioned the VM itself
  # via Terraform moments (or, worst case, one deploy cycle) earlier.
  ssh-keygen -R "$ip" >/dev/null 2>&1 || true
  ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes \
    -i "$SSH_KEY" "${ADMIN_USER}@${ip}" 'sudo cat /etc/rancher/k3s/k3s.yaml' \
    | sed "s/${ip//./\\.}/127.0.0.1/" > "$KCFG"
  chmod 600 "$KCFG"
  echo "Wrote $KCFG (server: https://127.0.0.1:6443, valid only while the tunnel is up)"
}

start() {
  local ip
  ip="$(vm_ip)"
  refresh_kubeconfig "$ip"
  write_plist "$ip"
  launchctl bootout "${UID_DOMAIN}/${LABEL}" >/dev/null 2>&1 || true
  launchctl bootstrap "$UID_DOMAIN" "$PLIST_PATH"
  echo "started: hetzner-pilot-tunnel -> ${LABEL} (127.0.0.1:6443 -> ${ip}:6443 via SSH)"
  echo "Use it: KUBECONFIG=$KCFG kubectl get nodes"
}

stop() {
  launchctl bootout "${UID_DOMAIN}/${LABEL}" >/dev/null 2>&1 || true
  rm -f "$PLIST_PATH"
  echo "stopped: hetzner-pilot-tunnel"
}

status() {
  if launchctl print "${UID_DOMAIN}/${LABEL}" >/dev/null 2>&1; then
    echo "hetzner-pilot-tunnel: running"
  else
    echo "hetzner-pilot-tunnel: NOT running"
  fi
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  restart) stop; sleep 1; start ;;
  status) status ;;
  *)
    echo "Usage: $0 {start|stop|restart|status}" >&2
    exit 1
    ;;
esac
