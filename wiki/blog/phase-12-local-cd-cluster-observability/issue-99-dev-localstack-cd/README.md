# Phase 12, Issue #99 — Wire `dev-localstack` Into the CD Workflow (Local Secrets/IAM by Default)

*Part of Phase 12 — Local CD & Cluster Observability. Not part of the
original four-issue planning batch — filed mid-phase. See
`docs/DECISIONS.md` D22/D23.*

## Why this came first

Phase 11 built a real, working LocalStack Secrets Manager/IAM
integration and deployed it into the `kind` cluster — but left it
opt-in by design (D22): `cd.yml` deployed the plain `dev` overlay, and
`dev-localstack` only ever got applied when someone remembered to run
through the manual walkthrough in `wiki/deployment-guide.md` section 5.
That's a real distinction worth sitting with: "the wiring works" and
"the wiring is actually used" are different claims, and D22 itself had
already made that exact point about a different bug in the same phase.
This issue exists because the user asked directly for the second claim,
not just the first — local secrets/IAM should back *every* local
deploy, not stay a occasional demo path. Concretely, it reverses D22's
own stated default, recorded honestly as D23 rather than silently
overwriting the earlier decision.

Importantly, this doesn't retrigger a real Phase 8b/8d production
trigger. The project is still solo, still local-only `kind`, with no
real AWS account and no shared/staging environment — the boundary D20
drew (LocalStack's free tier doesn't evaluate IAM policies for real, and
doesn't emulate EKS) is completely unchanged. Making the practice path
the default local behavior is not the same thing as starting production
hardening for real.

## Key concept: a `secretKeyRef` env var doesn't hot-reload, so ordering is the whole fix

LocalStack's Deployment reads its auth token from
`valueFrom.secretKeyRef` pointing at `localstack-credentials`. That's a
snapshot taken once, at container start — if the Secret doesn't exist
yet when the pod is first created, the pod won't magically start
working once the Secret shows up later; it needs an explicit restart to
re-read it. The manual walkthrough in section 5 always avoided this by
construction, just by ordering: create the Secret first, then apply the
overlay that creates the pod. Automating this meant preserving that same
ordering deliberately, not something `kubectl apply -k` would enforce on
its own — `cd.yml` provisions `localstack-credentials` in its own step,
strictly before `kubectl apply -k infra/k8s/overlays/dev-localstack`
runs.

## Key concept: interpolating a secret into a shell string vs. handing it to the shell as an environment variable

`${{ secrets.LOCALSTACK_AUTH_TOKEN }}` could be spliced directly into a
`run:` block's script text — GitHub Actions allows it, and plenty of
workflows do exactly that. It's also a known footgun class: the
secret's literal value becomes part of the generated shell script file
on disk, and if that value ever contained shell metacharacters (not
LocalStack's problem specifically, but a property of the pattern
itself), it could execute as commands rather than data. The safer,
standard pattern — used here — passes the secret through a step-scoped
`env:` block instead, so it's read as an environment variable lookup
(`"$LOCALSTACK_AUTH_TOKEN"`) rather than spliced text:

```yaml
- name: Provision LocalStack auth token secret
  env:
    LOCALSTACK_AUTH_TOKEN: ${{ secrets.LOCALSTACK_AUTH_TOKEN }}
  run: |
    kubectl create secret generic localstack-credentials \
      --namespace interview-insights \
      --from-literal=LOCALSTACK_AUTH_TOKEN="$LOCALSTACK_AUTH_TOKEN" \
      --dry-run=client -o yaml | kubectl apply -f -
```

The `--dry-run=client -o yaml | kubectl apply -f -` idiom makes this
idempotent — safe to run on every single CD invocation, creating the
Secret the first time and updating it in place on every run after,
rather than erroring on "already exists."

## System design approach

```yaml
- name: Ensure namespace exists
  run: kubectl apply -f infra/k8s/base/00-namespace.yaml

- name: Provision LocalStack auth token secret
  # (env: block above)

- name: Apply the dev-localstack overlay
  run: kubectl apply -k infra/k8s/overlays/dev-localstack

- name: Wait for LocalStack
  run: kubectl wait --for=condition=ready pod -l app=localstack -n interview-insights --timeout=120s

- name: Seed LocalStack secrets + IAM
  run: |
    kubectl -n interview-insights port-forward svc/localstack 4566:4566 &
    PF_PID=$!
    trap 'kill $PF_PID 2>/dev/null || true' EXIT
    for i in $(seq 1 15); do
      curl -sf http://localhost:4566/_localstack/health > /dev/null && break
      sleep 2
    done
    ./infra/aws/seed-localstack.sh
```

The reseed-every-run design deserves calling out explicitly: LocalStack's
Deployment has no `PersistentVolumeClaim` (it's a practice tool, not a
source of truth, per its own manifest comment from Phase 11) — its
in-memory secrets/IAM state doesn't survive a pod restart. Rather than
treating that as a gotcha to work around, CD just re-seeds unconditionally
on every run, via the already-idempotent `infra/aws/seed-localstack.sh`
from issue #78. A `docker stop`/`docker start` of the `kind` node between
deploys used to require a manual reseed (still documented as a gotcha in
section 5 for anyone applying the overlay by hand); a CD-triggered
redeploy now fixes that as a side effect, for free.

## Step-by-step: what actually got built

1. **Switched `cd.yml`'s deploy target** from `infra/k8s/overlays/dev`
   to `infra/k8s/overlays/dev-localstack`.
2. **Added the namespace-ensure step** for robustness against a truly
   fresh cluster, even though the live cluster already had the namespace
   from prior CD runs.
3. **Added the Secret-provisioning step**, ordered before the overlay
   apply for the `secretKeyRef` reason above, reading the token from a
   new `LOCALSTACK_AUTH_TOKEN` GitHub Actions repository secret (set via
   `gh secret set LOCALSTACK_AUTH_TOKEN`, a one-time manual step no
   workflow can do on its own).
4. **Added the readiness wait and reseed step**, with a backgrounded
   `kubectl port-forward` cleaned up via `trap ... EXIT` regardless of
   whether the seed script succeeds, and a short health-poll loop rather
   than a blind fixed sleep before hitting the port-forwarded endpoint.
5. **Validated the overlay in isolation first**: `kubectl kustomize
   infra/k8s/overlays/dev-localstack` before ever pushing, confirming it
   still built to valid, complete manifests.
6. **Recorded the decision honestly** as D23 in `docs/DECISIONS.md` —
   explicitly reversing D22's stated default, rather than editing D22 to
   pretend it always worked this way.
7. **Verified end-to-end against the real cluster**: merged the PR,
   started the runner, watched every step of the queued CD job succeed
   (namespace, Secret, overlay apply, LocalStack ready, seed script's
   full output including its own AssumeRole → temporary-credentials →
   `GetSecretValue` self-check), then proved `api` was genuinely reading
   from LocalStack — not merely reachable-but-unused — by creating a
   real candidate through the API and comparing its stored `email_hash`
   against an HMAC computed with both possible secret values:

   ```
   stored hash:                a060f604dad74cac6d38d16a7d6cb8b0400abb0f953d664a49cf862d341bee55
   HMAC w/ LocalStack secret:   a060f604dad74cac6d38d16a7d6cb8b0400abb0f953d664a49cf862d341bee55
   HMAC w/ plaintext k8s Secret: 2542237c64913658473f7135aced6879cea6b20ddb4e23c79d908291289eda31
   ```

   Only the LocalStack-seeded secret's HMAC matched — direct proof, not
   an assumption.

## What this enabled

Every local redeploy now genuinely exercises the secrets/IAM path Phase
11 built, instead of it sitting mostly-unused behind a manual opt-in.
It also leaves a template other opt-in infrastructure in this project
could follow later: prove it works in isolation first (Phase 11), then
deliberately decide — and document the decision, not just the code —
whether it graduates to being the default.
