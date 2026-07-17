# Phase 7, Issue #29 — Kustomize Overlays for dev/staging/prod

*Part of Phase 7 — Kubernetes. See `docs/ROADMAP.md` Phase 7,
`docs/ARCHITECTURE.md` "Deployment shape".*

Deep-dive by request, like the rest of Phase 7's posts — Kustomize's
base/overlay model, and the selector-immutability gotcha this issue ran
into directly, are both concepts worth understanding generally, not just
for this project.

## Why this came first

Issues #27 and #28 built one working configuration: Postgres, OpenSearch,
`api`, `web`, and an Ingress, all hardcoded to one namespace, one set of
image tags, one Ingress host pair. That's a complete, real, working
cluster — but it's also exactly one environment's worth of configuration,
with no structural way to express "the same shape, but staging" or "the
same shape, but prod" without copy-pasting every YAML file and hand-
editing the copies. Issue #29 is where that duplication problem gets
solved, and where this project first states an explicit, honest position
on *when* Kustomize itself stops being enough and Helm would be justified.

## Core concept: what Kustomize actually is, and how it differs from templating

Helm — the other major Kubernetes configuration tool — works by
*templating*: YAML files contain placeholder syntax (`{{ .Values.replicas
}}`) that gets substituted with real values from a separate values file
before the result is valid YAML at all. **Kustomize takes a different
approach: every file it operates on is *already* valid, complete
Kubernetes YAML — nothing is filled in, nothing is a template.**
Instead, a `kustomization.yaml` file describes *transformations* to apply
on top of that already-valid YAML: override a namespace, add a common
label, bump a replica count, patch one field of one resource. This
project's `infra/k8s/base/` (from issues #27/#28) is exactly that:
plain, directly-`kubectl apply`-able YAML, with zero placeholders.

This distinction is why Kustomize fits `docs/ARCHITECTURE.md`'s stated
preference ("start with plain manifests... add Kustomize overlays once
there's more than one environment to manage... don't reach for Helm until
manifests are genuinely repetitive") so naturally: the base manifests
never stop being real, valid, independently-applicable YAML. An overlay
is additive configuration on top, not a second, parallel representation
that has to first be "rendered" into YAML before anyone can reason about
what it actually deploys.

## Core concept: the base/overlay structure

A Kustomize *base* is any directory with a `kustomization.yaml` listing
the resources it manages:

```yaml
# infra/k8s/base/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - 00-namespace.yaml
  - 01-postgres-secret.yaml
  - 02-opensearch-config.yaml
  - 03-postgres.yaml
  - 04-opensearch.yaml
  - 05-api.yaml
  - 06-web.yaml
  - 07-ingress.yaml
```

An *overlay* is another `kustomization.yaml`, in its own directory, that
points back at a base (`resources: [../../base]`) and layers
transformations on top — without ever touching the base's own files.
This is the key structural property: **`dev`, `staging`, and `prod` never
diverge from each other by editing three separate copies of the same
YAML — they diverge by each declaring their own, independent set of
transformations against one shared, unmodified source.** Fix a bug in the
base, and every overlay picks it up automatically; there's no copy to
forget to update.

## Key concepts (project-specific)

- **`dev` can be a near-no-op overlay, and that's a legitimate, useful
  outcome, not a sign nothing was built.** `infra/k8s/base/` already *is*
  what `dev` needs — issues #27/#28 built and verified it directly. So
  `dev`'s overlay does almost nothing beyond formally declaring itself
  (an `environment: dev` label) and pinning the already-correct image
  tags. The value isn't in what it changes — it's in giving `dev` the
  *same kind of first-class, explicit identity* `staging`/`prod` have,
  rather than special-casing it as "just apply the base directly, that's
  the dev config" with no formal declaration anywhere.
- **`staging`/`prod` are honestly, explicitly structural-only** — not
  deployed anywhere real, because there's no real shared cluster for
  either yet (that's gated on Phase 8's actual triggers: secrets
  management, VPC networking, IAM). Building their *shape* now, without
  pretending they're production-ready, is the same "correct shape, no
  premature infrastructure" discipline as D9 — applied here to
  environment *structure* rather than to adding a whole new service.
- **The image tagging decision this issue actually had to make is more
  subtle than "pick a naming scheme."** `api`'s image is environment-
  agnostic — every difference it needs between environments is a runtime
  env var (ConfigMap/Secret), so the *same built image*, just re-tagged
  per release, works everywhere. `web` is fundamentally different: Phase
  7 issue #28 already established that Next.js bakes `NEXT_PUBLIC_API_URL`
  into the client bundle at *build* time — so `web`'s image for `staging`
  is not a re-tag of `dev`'s image, it is a **different build entirely**
  (`--build-arg NEXT_PUBLIC_API_URL=http://api.staging.interview-insights.
  local`). Getting this distinction right (and writing it down explicitly
  in the overlay's own comments) matters because the failure mode if it's
  gotten wrong is silent and confusing: reusing `dev`'s `web` image tag
  for `staging` would deploy a frontend that quietly calls the wrong API
  host, with no error at deploy time — it would simply fail (or worse,
  succeed against the wrong environment) the first time a user tried to
  use it.

## The real gotcha: `commonLabels` vs. `labels` + `includeSelectors: false`

This is the most transferable, "learned by actually hitting it" lesson
in this issue, and it generalizes to any Kustomize usage, not just this
project.

Kustomize has long supported a `commonLabels` field to stamp a label
(like `environment: dev`) onto every resource an overlay manages. The
obvious, natural first choice. But `commonLabels` doesn't just add the
label to `metadata.labels` — it **also adds it to
`spec.selector.matchLabels`** on Deployments/StatefulSets/Services, so
that label-based selection stays consistent. That's usually harmless — on
a *brand-new* deployment, adding a label to both the resource's own
labels and its selector at the same time is perfectly fine.

It's not harmless here, though, for a very specific reason:
**`spec.selector.matchLabels` on a Deployment or StatefulSet is immutable
after creation** — Kubernetes rejects any attempt to change it on an
already-existing object. And this issue's `dev` overlay was always going
to be applied *over* the exact `api`/`web`/`postgres`/`opensearch`
resources issues #27/#28 had already created and left running. Using
`commonLabels` here would have meant the very first `kubectl apply -k
infra/k8s/overlays/dev` failed outright, with a Kubernetes API error
about an immutable field — a real, concrete way this specific
combination of circumstances (an overlay applied over pre-existing,
already-running resources) turns a normally-harmless convenience feature
into a hard failure.

The fix is a newer Kustomize field, `labels:`, with an explicit opt-out:

```yaml
labels:
  - pairs:
      environment: dev
    includeSelectors: false
```

`includeSelectors: false` stamps the label onto `metadata.labels` and pod
template labels only, leaving `spec.selector.matchLabels` completely
untouched. **The general, transferable rule this demonstrates: when a
tool offers both a legacy all-in-one convenience feature and a newer,
more granular replacement, prefer the granular one specifically because
it lets you separate concerns (here: "labels for humans/tooling to
query by" vs. "labels the object's own identity/selection depends on")
that a single blanket setting conflates.** This is verified directly, not
just asserted: applying the `dev` overlay against the live cluster
produced zero pod restarts — proof it was a true no-op besides labels,
not a hidden, silently-successful recreation of every resource.

## System design approach — replicas, resources, and Ingress hosts per environment

Kustomize's built-in `replicas:` transformer targets a Deployment/
StatefulSet by name, letting `staging`/`prod` scale `api`/`web` without
touching Postgres or OpenSearch (both intentionally stay single-replica —
each is configured single-node, and scaling either is a real replication-
topology change, well out of this issue's scope):

```yaml
replicas:
  - name: api
    count: 2
  - name: web
    count: 2
```

Everything else that needs to change per environment (resource
requests/limits, the Ingress host, the matching `CORS_ORIGIN`) isn't
covered by a built-in transformer, so it's a `patches:` entry — a small,
targeted JSON6902 patch aimed at exactly one resource by kind and name:

```yaml
patches:
  - target: { kind: Deployment, name: api }
    patch: |-
      - op: replace
        path: /spec/template/spec/containers/0/resources
        value:
          requests: { cpu: 250m, memory: 512Mi }
          limits: { cpu: "1", memory: 1Gi }
  - target: { kind: Ingress, name: interview-insights }
    patch: |-
      - op: replace
        path: /spec/rules/0/host
        value: app.staging.interview-insights.local
      - op: replace
        path: /spec/rules/1/host
        value: api.staging.interview-insights.local
  - target: { kind: ConfigMap, name: api-config }
    patch: |-
      - op: replace
        path: /data/CORS_ORIGIN
        value: http://app.staging.interview-insights.local
```

Note the last two patches have to move *together* — the Ingress host and
`api-config`'s `CORS_ORIGIN` describe the same fact (what origin the
frontend will actually be served from) from two different resources'
perspectives, and they'd silently drift out of sync if only one were
updated per environment. This is exactly the kind of cross-resource
consistency requirement that's easy to satisfy correctly while writing
one overlay by hand, and easy to accidentally break the *next* time
someone edits just one of the two — worth calling out explicitly in the
overlay's own comments, which is where this project chose to record it,
rather than leaving it as tribal knowledge.

`staging` and `prod` end up structurally identical except for namespace,
hostnames, and image tags — a deliberate choice, not an oversight. There's
no real traffic or usage data yet to justify picking different replica
counts or resource values between the two; inventing a difference without
evidence would be exactly the kind of unjustified speculative tuning
`docs/DECISIONS.md` D9 warns against elsewhere in this project. The two
overlays exist as separately-adjustable structures for the day real data
*does* justify diverging them — not because they need to differ today.

## Step-by-step: what actually got built

1. **Added `infra/k8s/base/kustomization.yaml`**, listing every manifest
   issues #27/#28 had already written — turning the base directory into
   a real Kustomize base for the first time (previously just a directory
   `kubectl apply -f`'d directly).
2. **Replaced each overlay directory's `.gitkeep` placeholder** with a
   real `kustomization.yaml`.
3. **Built `dev`**: `resources: [../../base]`, an `environment: dev`
   label via `labels:`/`includeSelectors: false`, and an explicit (if
   currently redundant) `images:` pin to the `:k8s` tag issues #27/#28
   already built.
4. **Built `staging`**: its own namespace
   (`interview-insights-staging`), `environment: staging` label, 2
   replicas for `api`/`web` only, real-ish resource values, its own
   Ingress hosts + matching `CORS_ORIGIN`, and placeholder `:staging`
   image tags with an explicit comment on why `web`'s tag means a
   different build, not a re-tag.
5. **Built `prod`** identically in structure to `staging`, with its own
   namespace/hostnames/tags — and an explicit comment on *why* the two
   are deliberately near-identical right now (no evidence yet to justify
   diverging them).
6. **Verified all three build correctly and genuinely differ**:
   `kubectl kustomize` against each overlay, diffing `dev`'s output
   against `staging`'s to confirm real, substantive differences (not just
   comments) — satisfying the issue's own acceptance criteria directly.
7. **Applied `dev` for real**, over the exact live cluster issues
   #27/#28 had already stood up and verified — hit the `commonLabels`
   selector-immutability issue during this step (see above), fixed it
   with `labels:`/`includeSelectors: false`, then confirmed the
   corrected apply produced zero pod restarts and the app still
   responded correctly through the Ingress (`web` homepage `200`, `api`
   `/health` OK) — proving the overlay is safe to re-apply over already-
   running infrastructure, not just safe on a fresh cluster.
8. **Left `staging`/`prod` unapplied anywhere**, per the issue's own
   acceptance criteria — their manifests build correctly, and that's the
   whole deliverable until a real shared cluster exists.

## What this enabled

Phase 7 is now fully done for its planned scope (issues #27-#29). The
image-tagging distinction worked out here (`api`: same image, different
tag per release; `web`: a genuinely different build per environment) is
directly reusable guidance for any project mixing a backend service with
a frontend framework that bakes configuration in at build time — it's not
specific to Next.js or to this project's particular API. The
`labels:`/`includeSelectors: false` fix is equally general: any Kustomize
user applying an overlay over resources that might already exist should
prefer it over `commonLabels` by default, not just when a failure forces
the question.
