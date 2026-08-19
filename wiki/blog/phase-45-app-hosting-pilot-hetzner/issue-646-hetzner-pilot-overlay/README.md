# Phase 45, Issue #646 — `overlays/hetzner-pilot` Kustomize Overlay

*Part of Phase 45 — App-Hosting Pilot on Hetzner. See `docs/ROADMAP.md`
Phase 45.*

## The gap this closed

`infra/k8s/base` and its existing `dev`/`staging`/`prod` overlays all
assume a local `kind` cluster: `.local` hostnames, Mailpit, LocalStack,
`:k8s`-tagged images already loaded into the node's own containerd
store. None of that is true for a real, publicly-reachable VM. This
issue is the actual overlay that makes the pilot real — the piece
every other Phase 45/46 issue's output (the domain, the TLS cert, the
GHCR delivery path, the real SMTP relay) had to plug into somewhere.

## What's different from every other overlay

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../../base
```

No `namespace:` override, unlike `staging`/`prod` (which each get their
own namespace so multiple environments could theoretically coexist in
one cluster). This pilot is a genuinely separate cluster — no
collision risk reusing base's own `interview-insights` namespace name,
and reusing it meant #660/#662's own live verification (which had
already provisioned `ghcr-pull-secret`/`interview-insights-tls` into
exactly that namespace) got picked up automatically rather than needing
a second, differently-named copy.

No LocalStack resource, unlike `dev` — `overlays/hetzner-pilot`
deliberately does **not** add `../../base/localstack`. D102's Pattern B
decision (#647) means every secret this environment needs is
provisioned directly; there's nothing for LocalStack to emulate here.

Mailpit deleted outright, via a strategic-merge `$patch: delete`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: mailpit
  namespace: interview-insights
$patch: delete
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mailpit
  namespace: interview-insights
$patch: delete
```

Real SMTP (#655) replaces it entirely — no reason to run an unused pod.

## GHCR images, not local `:k8s` tags

```yaml
images:
  - name: interview-insights-api
    newName: ghcr.io/gowthamsiddarth/interview-insights-api
    newTag: PILOT_IMAGE_TAG_PLACEHOLDER
```

The placeholder is never deployed as-is — `cd-hetzner.yml` (#708) `sed`s
the real git-SHA tag into a checked-out copy of this file before
`kubectl apply -k`, never committed back. Every app Deployment also
picks up `imagePullSecrets: [{name: ghcr-pull-secret}]`, the secret
#660 proved live.

## Real hostnames, real TLS, wired to what #658/#662 already produced

```yaml
- target:
    kind: Ingress
    name: interview-insights
  patch: |-
    - op: replace
      path: /spec/rules/0/host
      value: app.interviewinsights.fyi
    - op: replace
      path: /spec/rules/1/host
      value: api.interviewinsights.fyi
    - op: add
      path: /spec/tls
      value:
        - hosts: [app.interviewinsights.fyi, api.interviewinsights.fyi]
          secretName: interview-insights-tls
```

`interview-insights-tls` is the exact Secret cert-manager (#662) already
populated with a real, independently-verified Let's Encrypt production
certificate — this overlay just points the Ingress at it. Deliberately
a standalone `Certificate` resource, not the more common ingress-shim
annotation pattern — see `infra/k8s/cert-manager/README.md` for why:
the cert was issued and proven *before* this overlay existed, and using
both mechanisms at once would mean two things trying to manage the same
Secret for no real benefit at single-operator scale.

## Verification

`kubectl kustomize infra/k8s/overlays/hetzner-pilot` rendered cleanly
before ever touching a live cluster: 21 resources, correct kind/count
breakdown (5 ConfigMaps, 4 Deployments, 1 Ingress, 1 Namespace, 7
Services, 3 StatefulSets), Mailpit confirmed absent, images resolving to
`ghcr.io` paths, TLS/hostnames correct. The real test — this overlay
actually applied to the live cluster, all four Deployments healthy —
is #648's job, not this issue's; see that post for the full story.
