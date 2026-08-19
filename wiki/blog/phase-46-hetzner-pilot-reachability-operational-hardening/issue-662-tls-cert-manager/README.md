# Phase 46, Issue #662 — TLS via cert-manager + Let's Encrypt

*Part of Phase 46 — Hetzner Pilot: Reachability & Operational Hardening.
See `docs/ROADMAP.md` Phase 46, Track A.*

## The gap this closed

Every other environment this project runs is plain HTTP — no TLS
termination anywhere, `COOKIE_SECURE: "false"` baked into
`infra/k8s/base/05-api.yaml`'s own ConfigMap. That's fine for a local
`kind` cluster; it's not acceptable for a pilot serving real candidates
over the real internet. This issue is what makes `https://` genuinely
true rather than aspirational.

## Staging first, deliberately, to protect a real rate limit

Let's Encrypt's production ACME server enforces a real rate limit (50
certs per registered domain per week) — burning through it on a
first-time setup, before confirming the whole HTTP-01 challenge chain
(DNS → firewall → ingress-nginx routing) actually works, would be a
self-inflicted problem. `cluster-issuer-staging.yaml` points at Let's
Encrypt's staging ACME server instead — certificates it issues aren't
trusted by real clients, but it has no meaningful rate limit, making it
the right tool to prove the mechanism first:

```bash
kubectl apply -f - <<CERT
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: staging-flow-test
  namespace: interview-insights
spec:
  secretName: staging-flow-test-tls
  issuerRef: {name: letsencrypt-staging, kind: ClusterIssuer}
  dnsNames: [app.interviewinsights.fyi]
CERT
```

```
issuer=C = US, O = Let's Encrypt, CN = (STAGING) Dastardly Durum YR1
```

Confirmed via decoding the actual issued cert, not just `kubectl`
reporting `Ready` — the `(STAGING)` prefix in the issuer's CN is the
concrete proof this was the test CA, not accidentally the real one.
Deleted immediately after — a throwaway proof, not meant to be kept.

## The real production cert, standalone rather than ingress-shim

```bash
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: interview-insights-pilot
  namespace: interview-insights
spec:
  secretName: interview-insights-tls
  issuerRef: {name: letsencrypt-production, kind: ClusterIssuer}
  dnsNames: [app.interviewinsights.fyi, api.interviewinsights.fyi]
```

cert-manager supports auto-creating a `Certificate` from an Ingress
carrying a `cert-manager.io/cluster-issuer` annotation — the more
common pattern. Deliberately not used here: this `Certificate` was
applied and issued successfully *before* `overlays/hetzner-pilot`'s own
Ingress existed (#646), specifically to prove the ACME flow independent
of the overlay. Once that Ingress did exist, it references
`interview-insights-tls` directly in its own `tls:` section — using
both mechanisms at once would mean two things trying to manage the same
Secret, unnecessary ambiguity at single-operator scale.

## Verified with a temporary Ingress, then curled from a genuinely
external machine

A `Certificate` reaching `Ready` proves cert-manager *issued* something
— it doesn't prove anything can actually *serve* it. A temporary
`nginx` pod + Service + Ingress (deleted immediately after) made the
real cert actually reachable, then:

```bash
curl -v https://app.interviewinsights.fyi/
```

```
* SSL certificate verify ok.
< HTTP/2 200
```

No `-k`/`--insecure` flag — a genuine trusted handshake, confirmed from
outside the cluster entirely, on a completely separate network from the
VM itself.

## Reissued a second time, same result

The pilot VM was later destroyed and recreated during an unrelated
architecture-migration attempt (D109/D110) — this exact sequence
(staging proof, production cert, temporary-Ingress verification) ran
again from scratch afterward, with the identical live-verified outcome.
Worth naming: this issue's own acceptance criteria held up as a real,
repeatable procedure, not a one-time lucky result.
