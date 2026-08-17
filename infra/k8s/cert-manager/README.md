# cert-manager (Hetzner pilot only)

GitHub issue #662 (Phase 46). cert-manager itself is installed via Helm
(D19's "Helm for third-party infra" precedent, same as `ingress-nginx` —
see `infra/scripts/bootstrap-kind.sh` and `../overlays`'s own README for
the equivalent local pattern). This directory holds the cluster-scoped
configuration on top of it — not part of `infra/k8s/base`'s own Kustomize
tree, since `ClusterIssuer`/`Certificate` are cluster infra, not
per-namespace application manifests, and (for now) only exist on the
Hetzner pilot, not `dev`/`staging`/`prod`'s local `kind` clusters.

## Files

- `cluster-issuer-staging.yaml` — Let's Encrypt's staging ACME server.
  Certificates it issues are **not trusted by real clients** (test CA),
  but it has no meaningful rate limit — use it to verify the HTTP-01
  challenge flow (DNS, firewall, ingress-nginx routing) actually works
  before ever touching the production issuer, which does have real rate
  limits (50 certs/registered domain/week).
- `cluster-issuer-production.yaml` — the real issuer.
- `certificate.yaml` — a standalone `Certificate` for both pilot
  hostnames (`app.`/`api.interviewinsights.fyi`), issued via the
  production issuer, stored in the `interview-insights-tls` Secret.

## Why a standalone `Certificate`, not cert-manager's ingress-shim annotation

cert-manager can auto-create a `Certificate` from an Ingress carrying a
`cert-manager.io/cluster-issuer` annotation + `tls:` section — the more
common pattern. Deliberately not used here: `certificate.yaml` was
applied (and issued successfully) *before* `overlays/hetzner-pilot`
(#646) existed, specifically to prove the ACME flow works without
waiting on that overlay. Once #646's Ingress exists, it should reference
`interview-insights-tls` directly in its own `tls:` section **without**
the ingress-shim annotation — using both would mean two things trying to
manage the same Secret, which cert-manager doesn't need and isn't worth
the ambiguity for a single-operator pilot.

## Renewal

Automatic — cert-manager watches the `Certificate` resource and renews
well before the 90-day Let's Encrypt expiry on its own, independent of
whatever Ingress ends up referencing the Secret.
