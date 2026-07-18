# Phase 11, Issue #78 — Deploy LocalStack (IAM + Secrets Manager) Into the kind Cluster

*Part of Phase 11 — Integrated Prototype: LocalStack Secrets & IAM in
kind. See `docs/ROADMAP.md` Phase 11, `docs/DECISIONS.md` D20/D22.*

## Why this came first

Phase 10 (issue #66) built a real, working integration between `api` and
LocalStack's Secrets Manager/IAM APIs — but deliberately never deployed
it anywhere; it existed purely as `docker-compose --profile localstack`,
disconnected from the actually-running `kind` cluster where `api` lives
day to day. This phase exists because the user asked a direct question:
is everything built across this project — Helm, Kustomize, Postgres,
OpenSearch, search, moderation, analytics, and now secrets/IAM —
actually running together anywhere, or just each individually verified
in its own isolated corner? An audit of the codebase (grepping for
`SecretsModule`'s usage, reading `docker-compose.yml`'s profile
boundaries, checking `docker ps` against the running `kind` containers)
confirmed the honest answer was no — LocalStack had never run within a
few network hops of the `kind` cluster at all. This issue is the first
step in closing that gap: get LocalStack running *inside* the cluster,
reachable by the `api` pod, before anything tries to consume it.

## Key concepts

- **Opt-in infrastructure is only real opt-in if it's structurally
  impossible to accidentally include.** `infra/k8s/base/localstack/`
  exists as a directory, but it is deliberately *not* listed in
  `infra/k8s/base/kustomization.yaml`'s `resources:` — the same
  "don't force premature infrastructure into the default path" instinct
  behind D9, just applied to a Kustomize base instead of a
  `docker-compose.yml` service list. Anyone applying the plain `dev`
  overlay gets exactly what they got before this issue; LocalStack only
  appears via the new, explicitly separate `dev-localstack` overlay.
- **Kustomize's load restrictor turns a natural first design into a
  wrong one.** The obvious way to add "one more resource" to an overlay
  is `resources: [../dev, ../../base/08-localstack.yaml]` — a directory
  plus a bare file. This fails outright: `security; file '...' is not in
  or below '...'`. Kustomize's default load restrictor allows an overlay
  to reference *another kustomization directory* from anywhere (that's
  what makes `../../base` safe to reuse across `dev`/`staging`/`prod` in
  the first place), but blocks referencing a *raw, non-kustomization
  YAML file* from outside the current kustomization's own directory
  tree. The fix wasn't a flag or an escape hatch — it was recognizing
  that the file needed to become a proper base itself: wrapping
  `08-localstack.yaml` in its own one-line `kustomization.yaml` inside
  `infra/k8s/base/localstack/` turned it from "a file being reached into"
  to "a base being referenced," which Kustomize always allows.
- **A ConfigMap patch that merges is a different tool than one that
  replaces.** `infra/k8s/overlays/dev-localstack/api-config-patch.yaml`
  only lists the four *new* keys `api` needs (`SECRETS_SOURCE`,
  `AWS_ENDPOINT_URL`, `AWS_REGION`, `AWS_SECRETS_ROLE_ARN`) — not the
  three keys `infra/k8s/base/05-api.yaml` already sets (`PORT`,
  `OPENSEARCH_URL`, `CORS_ORIGIN`). Kubernetes' strategic merge treats a
  ConfigMap's `data` field as a map to be merged key-by-key, not an
  object to be wholesale-replaced — a patch here is additive by the
  underlying API's own semantics, not because of anything special this
  project's YAML does.

## System design approach

```yaml
# infra/k8s/base/localstack/kustomization.yaml — the fix for the load-
# restriction problem: a real base, not a bare file reference.
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - 08-localstack.yaml
```

```yaml
# infra/k8s/overlays/dev-localstack/kustomization.yaml
resources:
  - ../dev
  - ../../base/localstack
patches:
  - path: api-config-patch.yaml
```

The LocalStack Deployment itself deliberately has no `PersistentVolumeClaim`
— unlike Postgres/OpenSearch's StatefulSets, which exist specifically to
survive pod restarts with real data intact, LocalStack here is a
practice/prototype tool, not a source of truth. Losing its in-memory
state on a pod restart just means re-running `seed-localstack.sh`, which
was written to be idempotent from the start for exactly this reason.

## Step-by-step: what actually got built

1. **Wrote the LocalStack Deployment + Service manifest** scoped to just
   `SERVICES=iam,secretsmanager` — matching `docker-compose`'s existing
   `localstack` profile scope exactly, not LocalStack's full service
   catalog.
2. **Hit the Kustomize load-restriction error** on the first `kubectl
   apply -k`, diagnosed the actual rule (directories: always allowed;
   bare files: root-restricted) by reading the error message carefully
   rather than reaching for a `--load-restrictor` flag, and restructured
   the manifest into its own nested base.
3. **Wrote `infra/aws/seed-localstack.sh`** — idempotent by construction
   (deletes any stale secret/role/policy from a previous run before
   creating fresh ones, the same pattern `verify-iam-policy.sh` already
   used in Phase 10), creating the two secrets `api` needs plus an
   `api-secrets-role` IAM role with the existing
   `api-secrets-access-policy.json` attached.
4. **Verified the seed script proves something real, not just "no
   error"**: after creating the role, it calls `sts assume-role` and
   then uses the *returned temporary credentials* (not the static `test`/
   `test` ones) to fetch a secret — proving the assume-role →
   temporary-credentials → `GetSecretValue` chain actually works, while
   being explicit in its own comments that this doesn't prove the
   *policy* is what's gating access, since LocalStack's free tier still
   doesn't evaluate IAM policies (the same limitation Phase 10 already
   found and documented in D20).
5. **Verified live against the real `kind` cluster**: applied the new
   overlay, confirmed via `kubectl get pods` that *only* the new
   LocalStack pod appeared — api/web/postgres/opensearch were completely
   undisturbed — then port-forwarded and ran the seed script twice to
   confirm idempotency.
6. **Confirmed the opt-in boundary with `kubectl kustomize` diffs**:
   `infra/k8s/base` and `infra/k8s/overlays/dev` both show zero mentions
   of LocalStack; only `dev-localstack` does — proof the separation is
   structural, not just a comment promising restraint.

## What this enabled

`api`'s pod now has a real, in-cluster LocalStack instance to talk to —
the prerequisite this phase's remaining two issues (#79, #80) both
depend on. Just as importantly, the opt-in pattern established here
(a nested base, never listed in the parent's `resources:`, composed only
by a dedicated overlay) is now a reusable template for any future
optional infrastructure this project adds to the `kind` cluster, the
same way `docker-compose`'s `profiles:` already solved the equivalent
problem for local Compose.
