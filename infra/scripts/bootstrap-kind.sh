#!/usr/bin/env bash
# One-shot, idempotent bootstrap for the full local kind environment
# (GitHub issue #107, Phase 13) — covers wiki/deployment-guide.md
# section 3 end to end: cluster create, Helm installs, image build/load,
# overlay apply, LocalStack provision + seed. Safe to re-run against an
# already-running cluster; every step either skips or upgrades in place.
#
# Requires: docker, kind, kubectl, helm, and LOCALSTACK_AUTH_TOKEN,
# ADMIN_PASSWORD_HASH, ADMIN_JWT_SECRET set in the environment (see
# wiki/deployment-guide.md sections 5 and 5b). ANTHROPIC_API_KEY is
# optional (GitHub issue #163) — leave it unset to keep AI moderation
# triage disabled.
set -euo pipefail

CLUSTER_NAME="interview-insights"
NAMESPACE="interview-insights"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [ -z "${LOCALSTACK_AUTH_TOKEN:-}" ]; then
  echo "ERROR: LOCALSTACK_AUTH_TOKEN is not set." >&2
  echo "Get one at app.localstack.cloud, then: export LOCALSTACK_AUTH_TOKEN=..." >&2
  exit 1
fi

# GitHub issue #192: the real admin credential is never committed to a
# manifest — only ever supplied via env var (locally) or a repo secret
# (CD). No dev-only fallback here on purpose, unlike EMAIL_HASH_SECRET's
# checked-in placeholder — this Secret's whole point is to not have one.
if [ -z "${ADMIN_PASSWORD_HASH:-}" ] || [ -z "${ADMIN_JWT_SECRET:-}" ]; then
  echo "ERROR: ADMIN_PASSWORD_HASH and/or ADMIN_JWT_SECRET is not set." >&2
  echo "See wiki/deployment-guide.md section 5b." >&2
  exit 1
fi

echo "== 1. kind cluster =="
if kind get clusters 2>/dev/null | grep -qx "$CLUSTER_NAME"; then
  echo "OK: cluster '$CLUSTER_NAME' already exists, skipping create"
else
  KIND_CONFIG=$(mktemp)
  cat > "$KIND_CONFIG" <<'EOF'
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
    kubeadmConfigPatches:
      - |
        kind: InitConfiguration
        nodeRegistration:
          kubeletExtraArgs:
            node-labels: "ingress-ready=true"
    extraPortMappings:
      - containerPort: 80
        hostPort: 80
      - containerPort: 443
        hostPort: 443
EOF
  kind create cluster --name "$CLUSTER_NAME" --config "$KIND_CONFIG"
  rm -f "$KIND_CONFIG"
fi

echo "== 2. ingress-nginx (Helm) =="
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx > /dev/null
helm repo update ingress-nginx > /dev/null
helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace \
  --set controller.hostPort.enabled=true \
  --set controller.service.type=ClusterIP \
  --set controller.nodeSelector."kubernetes\.io/os"=linux
kubectl -n ingress-nginx wait --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller --timeout=180s

echo "== 3. metrics-server (Helm) =="
helm repo add metrics-server https://kubernetes-sigs.github.io/metrics-server/ > /dev/null
helm repo update metrics-server > /dev/null
helm upgrade --install metrics-server metrics-server/metrics-server \
  --namespace kube-system \
  --set args={--kubelet-insecure-tls}
kubectl -n kube-system wait --for=condition=ready pod \
  --selector=app.kubernetes.io/name=metrics-server --timeout=120s

echo "== 4. Build and load api/web images =="
docker build -t interview-insights-api:k8s -f "$REPO_ROOT/api/Dockerfile" "$REPO_ROOT/api"
docker build -t interview-insights-web:k8s -f "$REPO_ROOT/web/Dockerfile" \
  --build-arg NEXT_PUBLIC_API_URL=http://api.interview-insights.local "$REPO_ROOT/web"
kind load docker-image interview-insights-api:k8s interview-insights-web:k8s \
  --name "$CLUSTER_NAME"

echo "== 5. Namespace =="
kubectl apply -f "$REPO_ROOT/infra/k8s/base/00-namespace.yaml"

echo "== 6. LocalStack auth token secret =="
kubectl create secret generic localstack-credentials \
  --namespace "$NAMESPACE" \
  --from-literal=LOCALSTACK_AUTH_TOKEN="$LOCALSTACK_AUTH_TOKEN" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "== 6b. Admin credentials secret (GitHub issue #192) =="
kubectl create secret generic admin-credentials \
  --namespace "$NAMESPACE" \
  --from-literal=ADMIN_PASSWORD_HASH="$ADMIN_PASSWORD_HASH" \
  --from-literal=ADMIN_JWT_SECRET="$ADMIN_JWT_SECRET" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "== 6c. AI moderation secret (GitHub issue #163) =="
# Genuinely optional, unlike 6b above: an empty ANTHROPIC_API_KEY just
# leaves AiModerationService's advisory triage disabled — nothing else in
# the app depends on it, so this never exits non-zero the way the
# ADMIN_*/LOCALSTACK_AUTH_TOKEN checks above do.
kubectl create secret generic anthropic-credentials \
  --namespace "$NAMESPACE" \
  --from-literal=ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "== 7. Apply the dev-localstack overlay =="
kubectl apply -k "$REPO_ROOT/infra/k8s/overlays/dev-localstack"

echo "== 8. Wait for LocalStack + its non-api dependents ready =="
# Deliberately excludes api: on a truly fresh cluster api's entrypoint
# fetches its secrets from LocalStack at boot (api/scripts/entrypoint.js)
# and crash-loops with ResourceNotFoundException until LocalStack is
# seeded below - it can never reach Ready before step 9 runs. Found by
# this issue's own adversarial rebuild (GitHub issue #108): earlier
# testing against an already-running cluster never restarted api from
# zero, so this ordering bug stayed invisible until a truly fresh boot
# forced api through its real first-start path. Same reason cd.yml only
# waits on localstack here, then seeds, then explicitly rolls out api
# afterward instead of waiting on every pod up front.
kubectl -n "$NAMESPACE" wait --for=condition=ready pod -l app=postgres --timeout=180s
kubectl -n "$NAMESPACE" wait --for=condition=ready pod -l app=opensearch --timeout=180s
kubectl -n "$NAMESPACE" wait --for=condition=ready pod -l app=redpanda --timeout=180s
kubectl -n "$NAMESPACE" wait --for=condition=ready pod -l app=localstack --timeout=180s
kubectl -n "$NAMESPACE" wait --for=condition=ready pod -l app=web --timeout=180s

echo "== 9. Seed LocalStack secrets + IAM =="
kubectl -n "$NAMESPACE" port-forward svc/localstack 4566:4566 &
PF_PID=$!
trap 'kill $PF_PID 2>/dev/null || true' EXIT
for i in $(seq 1 15); do
  curl -sf http://localhost:4566/_localstack/health > /dev/null && break
  sleep 2
done
"$REPO_ROOT/infra/aws/seed-localstack.sh"
kill $PF_PID 2>/dev/null || true
trap - EXIT

echo "== 10. Roll out api to pick up LocalStack-backed secrets =="
kubectl -n "$NAMESPACE" rollout restart deployment/api
kubectl -n "$NAMESPACE" rollout status deployment/api --timeout=90s

echo ""
echo "== Done =="
kubectl -n "$NAMESPACE" get pods
echo ""
echo "Reach it (no /etc/hosts edit needed):"
echo "  curl --resolve app.interview-insights.local:80:127.0.0.1 http://app.interview-insights.local/"
echo "  curl --resolve api.interview-insights.local:80:127.0.0.1 http://api.interview-insights.local/health"
echo ""
echo "Monitor it:"
echo "  kubectl top pods -n $NAMESPACE"
echo "  k9s -n $NAMESPACE"
