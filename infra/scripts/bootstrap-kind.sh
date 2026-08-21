#!/usr/bin/env bash
# One-shot, idempotent bootstrap for the full local kind environment
# (GitHub issue #107, Phase 13) — covers wiki/deployment-guide.md
# section 3 end to end: cluster create, Helm installs, image build/load,
# overlay apply, LocalStack provision + seed. Safe to re-run against an
# already-running cluster; every step either skips or upgrades in place.
#
# Requires: podman, kind, kubectl, helm, and LOCALSTACK_AUTH_TOKEN,
# ADMIN_PASSWORD_HASH, ADMIN_JWT_SECRET, POSTGRES_PASSWORD set in the
# environment (see wiki/deployment-guide.md sections 5 and 5b;
# POSTGRES_PASSWORD added by GitHub issue #466/D77). ANTHROPIC_API_KEY is
# optional (GitHub issue #163) — leave it unset to keep AI moderation
# triage disabled.
#
# GitHub issue #540 (D89/D90): migrated off Docker onto Podman —
# `KIND_EXPERIMENTAL_PROVIDER=podman` below (kind's own docs mark this
# provider experimental, not GA, same caveat D84/#539 flagged) and
# `podman save | kind load image-archive` in place of `kind load
# docker-image`, which fails against a podman-built image on a
# `localhost/`-prefix naming mismatch (D88/#545).
set -euo pipefail

export KIND_EXPERIMENTAL_PROVIDER=podman
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
# (CD). No dev-only fallback here on purpose: unlike EMAIL_HASH_SECRET/
# EMAIL_ENCRYPTION_KEY/CANDIDATE_JWT_SECRET below (6b2), this needs a
# real bcrypt hash a script can't generate on its own, so there's no
# generate-it-ourselves option here the way there is for those.
if [ -z "${ADMIN_PASSWORD_HASH:-}" ] || [ -z "${ADMIN_JWT_SECRET:-}" ]; then
  echo "ERROR: ADMIN_PASSWORD_HASH and/or ADMIN_JWT_SECRET is not set." >&2
  echo "See wiki/deployment-guide.md section 5b." >&2
  exit 1
fi

# GitHub issue #466, D77: same never-committed-fallback reasoning as
# ADMIN_PASSWORD_HASH/ADMIN_JWT_SECRET above, applied to Postgres's own
# credential — Postgres needs it before any of our app code exists to
# fetch one from Secrets Manager, so it's provisioned imperatively
# instead of via the LocalStack-at-boot pattern api/notification-service
# use for their own secrets.
if [ -z "${POSTGRES_PASSWORD:-}" ]; then
  echo "ERROR: POSTGRES_PASSWORD is not set." >&2
  echo "See wiki/deployment-guide.md section 5b." >&2
  exit 1
fi

# GitHub issue #803 (Phase 55) — EMAIL_HASH_SECRET/EMAIL_ENCRYPTION_KEY/
# CANDIDATE_JWT_SECRET used to default to a checked-in placeholder inside
# infra/aws/seed-localstack.sh and infra/k8s/base/localstack/init/seed.sh
# — a real, working secret committed to the repo, exactly what CLAUDE.md
# hard constraint #6 forbids. Unlike ADMIN_PASSWORD_HASH/ADMIN_JWT_SECRET
# above (a bcrypt hash this script can't generate on its own), these are
# plain random strings it can — auto-generated below, once per cluster
# (reused on every idempotent re-run against an already-provisioned
# cluster, read back from the email-secrets k8s Secret's existing value
# rather than regenerated, or every re-run would rotate the key and break
# decryption of any candidate email already encrypted under the old one).

echo "== 1. kind cluster =="
# GitHub issue #540 (D91): `kind get clusters` itself is broken under
# Podman 6.0.2/kind v0.32.0's experimental podman provider -- it shells
# out to `podman ps --format '{{index .Labels "io.x-k8s.kind.cluster"}}'`,
# a Go-template form that assumes .Labels is a map (true for `docker ps`,
# not for this Podman version's ps template context, which errors with
# "cannot index slice/array with type string"). `kind get clusters`
# silently reports zero clusters as a result, breaking this exact
# already-exists check. Checking the node container directly via `podman
# ps` sidesteps kind's own broken enumeration entirely, and is at least
# as accurate now that this script always runs under
# KIND_EXPERIMENTAL_PROVIDER=podman anyway.
if podman ps --filter "name=^${CLUSTER_NAME}-control-plane$" --filter "status=running" --format '{{.Names}}' 2>/dev/null | grep -qx "${CLUSTER_NAME}-control-plane"; then
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
podman build -t interview-insights-api:k8s -f "$REPO_ROOT/api/Dockerfile" "$REPO_ROOT/api"
podman build -t interview-insights-web:k8s -f "$REPO_ROOT/web/Dockerfile" \
  --build-arg NEXT_PUBLIC_API_URL=http://api.interview-insights.local "$REPO_ROOT/web"
# GitHub issue #540 (D91): re-tag under docker.io/library/ before saving --
# Podman canonicalizes a locally built, unqualified image as
# localhost/<name>:<tag>, but every manifest in this repo references the
# bare name, which containerd's own short-name resolution expands to
# docker.io/library/<name>:<tag> -- not localhost/<name>:<tag>. Without
# this, kubelet doesn't find the loaded image locally and attempts (and
# fails) a real Docker Hub pull instead. See cd.yml's own "Load images
# into kind" step comment for the full writeup.
for img in interview-insights-api:k8s interview-insights-web:k8s; do
  podman tag "$img" "docker.io/library/$img"
  podman save "docker.io/library/$img" | kind load image-archive /dev/stdin --name "$CLUSTER_NAME"
done

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

echo "== 6b2. Email/candidate secrets (GitHub issue #803, Phase 55) =="
# Reuse the existing Secret's values on a re-run against an
# already-provisioned cluster — see the requirement-check comment above
# for why regenerating on every re-run would be worse than the
# checked-in-placeholder problem this replaces.
EMAIL_HASH_SECRET="$(kubectl get secret email-secrets -n "$NAMESPACE" \
  -o jsonpath='{.data.EMAIL_HASH_SECRET}' 2>/dev/null | base64 -d || true)"
EMAIL_ENCRYPTION_KEY="$(kubectl get secret email-secrets -n "$NAMESPACE" \
  -o jsonpath='{.data.EMAIL_ENCRYPTION_KEY}' 2>/dev/null | base64 -d || true)"
CANDIDATE_JWT_SECRET="$(kubectl get secret email-secrets -n "$NAMESPACE" \
  -o jsonpath='{.data.CANDIDATE_JWT_SECRET}' 2>/dev/null | base64 -d || true)"
EMAIL_HASH_SECRET="${EMAIL_HASH_SECRET:-$(openssl rand -hex 32)}"
EMAIL_ENCRYPTION_KEY="${EMAIL_ENCRYPTION_KEY:-$(openssl rand -hex 32)}"
CANDIDATE_JWT_SECRET="${CANDIDATE_JWT_SECRET:-$(openssl rand -hex 32)}"
kubectl create secret generic email-secrets \
  --namespace "$NAMESPACE" \
  --from-literal=EMAIL_HASH_SECRET="$EMAIL_HASH_SECRET" \
  --from-literal=EMAIL_ENCRYPTION_KEY="$EMAIL_ENCRYPTION_KEY" \
  --from-literal=CANDIDATE_JWT_SECRET="$CANDIDATE_JWT_SECRET" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "== 6c. AI moderation secret (GitHub issue #163, D81) =="
# Genuinely optional, unlike 6b above: an empty ANTHROPIC_API_KEY just
# leaves review-analyzer's advisory triage disabled (GitHub issue #340
# moved this from api's own AiModerationService, D81) — nothing else in
# the app depends on it, so this never exits non-zero the way the
# ADMIN_*/LOCALSTACK_AUTH_TOKEN checks above do.
kubectl create secret generic anthropic-credentials \
  --namespace "$NAMESPACE" \
  --from-literal=ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "== 6d. Postgres credentials secret (GitHub issue #466, D77) =="
kubectl create secret generic postgres-credentials \
  --namespace "$NAMESPACE" \
  --from-literal=POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "== 7. Apply the dev overlay =="
kubectl apply -k "$REPO_ROOT/infra/k8s/overlays/dev"

echo "== 8. Wait for LocalStack + its non-api/notification-service dependents ready =="
# Deliberately excludes api and (since GitHub issue #466/D76, which made
# LocalStack unconditional for it too) notification-service: on a truly
# fresh cluster their entrypoints fetch secrets from LocalStack at boot
# and crash-loop with ResourceNotFoundException until LocalStack is
# seeded below - neither can ever reach Ready before step 9 runs. Found by
# this issue's own adversarial rebuild (GitHub issue #108): earlier
# testing against an already-running cluster never restarted api from
# zero, so this ordering bug stayed invisible until a truly fresh boot
# forced api through its real first-start path. Same reason cd.yml only
# waits on localstack here, then seeds, then explicitly rolls out api/
# notification-service afterward instead of waiting on every pod up front.
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
SEED_EMAIL_HASH_SECRET="$EMAIL_HASH_SECRET" \
SEED_EMAIL_ENCRYPTION_KEY="$EMAIL_ENCRYPTION_KEY" \
SEED_CANDIDATE_JWT_SECRET="$CANDIDATE_JWT_SECRET" \
"$REPO_ROOT/infra/aws/seed-localstack.sh"
kill $PF_PID 2>/dev/null || true
trap - EXIT

echo "== 10. Roll out api/notification-service to pick up LocalStack-backed secrets =="
kubectl -n "$NAMESPACE" rollout restart deployment/api
kubectl -n "$NAMESPACE" rollout status deployment/api --timeout=90s
kubectl -n "$NAMESPACE" rollout restart deployment/notification-service
kubectl -n "$NAMESPACE" rollout status deployment/notification-service --timeout=90s

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
