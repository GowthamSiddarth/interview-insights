# Phase 12, Issue #90 — k9s + metrics-server for Local Cluster Monitoring

*Part of Phase 12 — Local CD & Cluster Observability. See
`docs/ROADMAP.md` Phase 12.*

## Why this came first

Issues #88, #89, and #99 all made deploys automatic — but none of them
made it any easier to actually *look at* the cluster while diagnosing
something. Up to this point, every check was a hand-typed `kubectl get
pods`, `kubectl logs`, or `kubectl describe`, one resource at a time,
with no live resource-usage numbers at all (no metrics API was ever
deployed into this cluster). This issue is independent of #88/#89/#99 —
it doesn't touch the deploy pipeline, doesn't add a manifest to any
overlay `cd.yml` applies, and could have been done in any order relative
to the rest of the phase. It closes a different gap: quick, live
visibility into a cluster that, by this point, runs five real workloads
(`api`, `web`, `postgres`, `opensearch`, `localstack`).

## Core concept: `kubectl top` needs a metrics pipeline; kubelets don't expose it for free

`kubectl top nodes` and `kubectl top pods` look like basic `kubectl`
functionality, but they're not built into the API server at all — they
depend on the **Metrics API** (`metrics.k8s.io`), which nothing serves
until something implements it. `metrics-server` is that something: a
small in-cluster component that periodically scrapes CPU/memory
[stats from every kubelet](https://kubernetes-sigs.github.io/metrics-server/)
and exposes them through the Metrics API for `kubectl top`, the
Horizontal Pod Autoscaler, and tools like `k9s` to consume. Without it,
`kubectl top` doesn't error gracefully — it just fails outright, because
there's genuinely nothing behind the API it's calling.

## Core concept: `kind`'s kubelet certs don't satisfy metrics-server's default trust model

`metrics-server` defaults to verifying each kubelet's TLS certificate
against a real CA before scraping it — a sensible default for a real
cloud cluster, where kubelets are provisioned with certs a proper CA
actually signed. `kind` nodes run inside Docker containers with
self-signed kubelet certs that satisfy `kubectl`'s own connection (which
uses a different, already-trusted path) but fail `metrics-server`'s
stricter verification. This is thoroughly well-known in the `kind`
ecosystem — the fix is the documented `--kubelet-insecure-tls` flag,
which tells `metrics-server` to skip that specific verification step. It's
a `kind`-specific accommodation, not a security compromise anyone would
carry into a real cloud deployment with properly-issued certs.

## System design approach

`metrics-server` is third-party infrastructure — maintained upstream,
distributed as a Helm chart — so it follows the same pattern D19
established for `ingress-nginx`: Helm for infra the wider ecosystem
packages as a chart, Kustomize for this project's own manifests. It
never becomes a Kustomize-managed resource under `infra/k8s/base/`.

```bash
helm repo add metrics-server https://kubernetes-sigs.github.io/metrics-server/
helm repo update
helm install metrics-server metrics-server/metrics-server \
  --namespace kube-system \
  --set args={--kubelet-insecure-tls}
kubectl -n kube-system wait --for=condition=ready pod \
  --selector=app.kubernetes.io/name=metrics-server --timeout=120s
```

`k9s` needed nothing structural at all — it's a terminal UI binary that
talks to whatever cluster the active `kubeconfig` context points at,
installed with `brew install k9s` and launched with `k9s -n
interview-insights`. Its Pods view sources its CPU/memory columns from
the exact same Metrics API `metrics-server` now serves — if
`metrics-server` is unhealthy, `k9s`'s resource columns go blank at the
same time `kubectl top` starts erroring; there's one dependency behind
both, not two things that can independently break.

## Step-by-step: what actually got built and verified

1. **Installed `k9s` locally** via `brew install k9s` — no cluster
   changes at all for this half of the issue.
2. **Added the `metrics-server` Helm repo** and installed the chart into
   `kube-system` with `--kubelet-insecure-tls` set via `--set args=`.
3. **Waited for the pod to become ready**, then verified against the
   real, already-running cluster (not a fresh one spun up just for this
   check) — five live pods including `api`, `web`, `postgres`,
   `opensearch`, and `localstack` from prior Phase 12 work:

   ```
   $ kubectl top nodes
   NAME                               CPU(cores)   CPU(%)   MEMORY(bytes)   MEMORY(%)
   interview-insights-control-plane   336m         4%       2715Mi          69%

   $ kubectl top pods -n interview-insights
   NAME                        CPU(cores)   MEMORY(bytes)
   api-5fc4788d56-r8nwh        5m           65Mi
   localstack-c6f5c647-zpj5q   6m           411Mi
   opensearch-0                22m          911Mi
   postgres-0                  11m          27Mi
   web-6db97c845c-s7nvs        4m           88Mi
   ```
4. **Verified `k9s` connects to the live cluster**, not just that the
   binary runs — launching it headlessly against the real context
   confirmed `✅ Kubernetes connectivity OK` in its own log output before
   it was closed back down.
5. **Documented both** in `wiki/deployment-guide.md` section 3.6,
   explicitly framed as lightweight local tooling, not a
   Prometheus/Grafana/Loki/Jaeger-style observability stack — that stays
   scoped to Phase 8f's own "local equivalent" bullet, gated on a real
   shared/staging trigger this project still hasn't hit.

## What this enabled

Live, at-a-glance visibility into everything Phase 12's own CD pipeline
now deploys automatically — real resource numbers instead of "it's
probably fine," and a fast way to inspect pods/logs interactively while
debugging something #89 or #99's automation surfaces, without reaching
for a heavier tool this project's scale doesn't yet justify.
