# Phase 13, Issue #107 — One-Shot Local Bootstrap Script for the Full kind Environment

*Part of Phase 13 — Local Infra Hardening & Reproducibility. See
`docs/ROADMAP.md` Phase 13.*

## Why this came first

`wiki/deployment-guide.md` section 3 documents the full `kind`
environment build-up in six numbered steps — create the cluster,
install `ingress-nginx` and `metrics-server` via Helm, build and load
images, apply the overlay, provision and seed LocalStack. Each step is
correct and well-tested individually, but reproducing the *whole*
environment from nothing has only ever meant a human manually
executing all of them in order, copy-pasting from the guide. That's
slow, and worse, it means "the environment is reproducible" was never
actually a tested claim — it was an assumption resting on a docs file
staying perfectly in sync with reality and a human never skipping a
step. Scripting it turns that assumption into something that either
works or visibly doesn't.

## Key concept: idempotent means every step tolerates already being done, not just "safe to run twice"

The easy version of "idempotent" is a script that doesn't corrupt state
on a second run. The harder, more useful version — the one this script
needed — is one that produces the *same correct end state* whether the
starting point is nothing at all or an environment that's already
fully up and running, without erroring in either direction. That
shaped every step's implementation choice: `kind get clusters | grep
-qx` before creating (a `kind create cluster` against an existing name
just errors), `helm upgrade --install` instead of `helm install` for
both charts (the standard idiom for exactly this), and `kubectl apply`
throughout rather than `kubectl create` (declarative reconciliation,
not an error on "already exists"). `infra/aws/seed-localstack.sh`
already had this property from Phase 11 — this script just needed to
match it everywhere else too.

## System design approach

```bash
# infra/scripts/bootstrap-kind.sh — abbreviated
if kind get clusters 2>/dev/null | grep -qx "$CLUSTER_NAME"; then
  echo "OK: cluster already exists, skipping create"
else
  # ... kind create cluster --config ...
fi

helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx ...
helm upgrade --install metrics-server metrics-server/metrics-server ...

docker build -t interview-insights-api:k8s -f api/Dockerfile api
docker build -t interview-insights-web:k8s -f web/Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=http://api.interview-insights.local web
kind load docker-image interview-insights-api:k8s interview-insights-web:k8s --name "$CLUSTER_NAME"

kubectl apply -f infra/k8s/base/00-namespace.yaml
kubectl create secret generic localstack-credentials \
  --from-literal=LOCALSTACK_AUTH_TOKEN="$LOCALSTACK_AUTH_TOKEN" \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -k infra/k8s/overlays/dev-localstack
```

The `LOCALSTACK_AUTH_TOKEN` requirement is checked and fails loudly at
the very top of the script (`[ -z "${LOCALSTACK_AUTH_TOKEN:-}" ] &&
exit 1`) rather than letting the script run partway and fail confusingly
minutes later at the LocalStack step — a fast, clear failure beats a
slow, cryptic one.

The script deliberately mirrors `cd.yml`'s own provisioning sequence
(namespace → Secret → overlay → seed) rather than inventing a
different one — one correct, tested ordering, expressed twice (once
for CI/CD, once for local bootstrap) rather than two orderings that
could quietly drift apart. That mirroring is also exactly what made
issue #108 possible to fix cleanly: the bug it found was an ordering
difference from `cd.yml`, and the fix was bringing this script back
into alignment with the pattern that already worked.

## Step-by-step: what actually got built

1. **Transcribed section 3's manual steps into the script directly**,
   preserving the exact commands (same image tags, same Helm chart
   versions and flags, same overlay name) rather than approximating
   them — the goal was one script that *is* the documented process, not
   a parallel implementation that could drift from it.
2. **Added the idempotency checks** (cluster-exists guard, `helm
   upgrade --install`) so the script would be safe to run repeatedly,
   not just once from empty.
3. **Verified against the real, already-running cluster twice back to
   back** — deliberately not a fresh cluster yet (that's issue #108's
   job) — confirming every skip/upgrade path actually took the "already
   exists" branch rather than erroring, and that the app stayed
   reachable and healthy after each run (`GET /health` → `200`, `GET /`
   → `200`).
4. **Documented it as the new fast path** in `wiki/deployment-guide.md`
   section 3, keeping the original manual walkthrough underneath as the
   "what each step actually does" reference — useful for debugging a
   single step in isolation, which the script itself doesn't easily
   support once it's running end to end.

## What this enabled

A single command that stands up the entire local environment from
whatever state it's currently in — the load-bearing tool issue #108's
adversarial verification needed to even attempt a from-scratch rebuild
in the first place, and directly responsible for that issue finding a
real bug: running the *exact same script* against a genuinely empty
cluster, instead of an already-warm one, is what finally exercised a
code path nothing had ever actually tested before.