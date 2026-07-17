# Phase 10, Issue #65 — Install ingress-nginx via Helm

*Part of Phase 10 — Cloud-Readiness Practice (Local, Free). See
`docs/ROADMAP.md` Phase 10, `docs/DECISIONS.md` D19.*

Deep-dive by request — the scoping question this issue answers (when
does Helm actually earn its keep, versus when is it reached for out of
habit) comes up in nearly every real Kubernetes project, well beyond
this one.

## Why this came first

Phase 7 installed `ingress-nginx` with `kubectl apply -f
.../deploy.yaml` — the raw upstream manifest, applied directly, the same
way this project manages its own `api`/`web`/`postgres`/`opensearch`
resources. That was a reasonable starting choice, but it quietly
mismatched how the wider Kubernetes ecosystem actually distributes
`ingress-nginx`: as a versioned Helm chart, with its own release
history, upgrade path, and rollback mechanism. This issue is where that
mismatch gets corrected — not by adopting Helm everywhere, but by asking
precisely where it belongs.

## Core concept: what actually earns Helm its place, when raw manifests already work

This project already has a clear, correct answer for *our own* app: the
Helm-trigger note in `docs/ROADMAP.md` says don't reach for Helm until
manifests are "genuinely repetitive across services" — and with 2 app
services and 2 stateful deps, backed by Kustomize overlays that already
solve the per-environment duplication problem, that trigger genuinely
hasn't fired. It would be easy to stop there and conclude "we don't need
Helm at all." That conclusion would be wrong, and the reason why is the
transferable lesson of this issue.

**Repetitiveness across your own services is not the only reason to use
Helm.** A second, completely independent reason exists: **you don't own
the release cadence of third-party infrastructure.** `ingress-nginx`,
`cert-manager`, `prometheus`, `external-dns` — the maintainers of these
projects publish new versions, and *they* choose Helm as the distribution
mechanism, with `values.yaml` as the supported configuration surface. When
you `kubectl apply -f` their raw manifest instead:

- You're pinning to whatever revision happened to be at that URL the day
  you ran the command — there's no record of *which* version, no clean
  path to see what changed before upgrading.
- Upgrading means diffing and reapplying a whole new manifest by hand,
  hoping you don't clobber something you'd customized.
- Rolling back a bad upgrade means finding the old manifest again and
  reapplying it — there's no `helm rollback`.

None of this is about whether *your* manifests are repetitive. It's
about the fact that someone else's release process expects to be
consumed through `helm upgrade`/`helm rollback`, and working against that
expectation with raw `kubectl apply` is friction you're choosing to keep
paying, release after release, for no benefit.

**The resulting rule, recorded as D19**: Helm for third-party
infrastructure, Kustomize for your own app manifests. These aren't
competing choices to pick one of — they solve genuinely different
problems, and a real production cluster commonly runs both side by side
with zero conflict.

## System design approach

The migration itself is a straightforward swap, but two details matter
for correctness on `kind` specifically:

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace \
  --set controller.hostPort.enabled=true \
  --set controller.service.type=ClusterIP \
  --set controller.nodeSelector."kubernetes\.io/os"=linux
```

`controller.hostPort.enabled=true` is the one setting that actually
matters here — it replicates the `hostPort: 80`/`hostPort: 443` container
ports the original raw manifest had, which is what makes `kind`'s
`extraPortMappings` (mapping the *host* machine's ports 80/443 into the
cluster node) actually reach the controller. Without it, the Helm
chart's defaults assume a cloud provider's real LoadBalancer will
provision an external IP — which never happens on `kind`, since there's
no cloud to provision one. Getting this wrong wouldn't fail loudly; the
controller would just come up healthy and be completely unreachable from
outside the cluster, a much harder failure mode to diagnose than an
install erroring out.

The other correctness requirement was implicit: the resulting
`IngressClass` has to still be named `nginx`, since `infra/k8s/base/07-
ingress.yaml`'s `ingressClassName: nginx` field references it by that
exact name. The Helm chart's default `controller.ingressClassResource.
name` already happens to be `nginx`, so no override was needed — but this
was verified directly (`kubectl get ingressclass`) rather than assumed,
since a name mismatch would have silently broken every existing Ingress
resource in the cluster.

## Step-by-step: what actually got built

1. **Confirmed the exact hostPort/nodeSelector configuration** the
   existing, working controller was using
   (`kubectl get deploy ingress-nginx-controller -o yaml`) before
   touching anything — the goal was matching this exactly, not
   guessing at reasonable-looking Helm values.
2. **Removed the manually-installed `ingress-nginx`** via `kubectl
   delete -f` against the same upstream URL it was originally installed
   from — cleanly tears down everything that install created.
3. **Installed via Helm** with the three `--set` overrides above.
4. **Verified the `IngressClass` name matched** (`nginx`, confirmed via
   `kubectl get ingressclass`) before assuming anything else would work.
5. **Re-applied the `dev` Kustomize overlay** (`kubectl apply -k
   infra/k8s/overlays/dev`) to prove Helm-managed infra and
   Kustomize-managed app manifests coexist in the same cluster without
   either fighting the other for the same resources.
6. **Ran the full golden-path Playwright verification** (create company →
   process → round → rating) through the newly Helm-installed
   controller — zero console errors, proving the migration didn't
   silently break the actual traffic path, not just that the pods came
   up.
7. **Updated `README.md`'s local Kubernetes setup instructions** to the
   Helm commands, so a fresh clone of this repo never sees the old raw
   manifest approach at all.

## What this enabled

This is the direct precedent for how any future third-party component
gets added to this project's Kubernetes setup — `cert-manager`,
`prometheus`/`grafana`, whatever Phase 8 eventually needs — each goes in
via Helm, following this exact pattern, while `api`/`web`/`postgres`/
`opensearch` stay Kustomize-managed indefinitely, unless the Helm-trigger
note's actual condition (our own manifests becoming genuinely
repetitive) is ever met on its own terms. The "repetitiveness isn't the
only reason to use Helm — not owning the release cadence is a second,
independent reason" distinction is the one piece of this issue worth
carrying into any other Kubernetes project, not just this one.
