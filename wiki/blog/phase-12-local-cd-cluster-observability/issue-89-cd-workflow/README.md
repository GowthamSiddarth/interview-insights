# Phase 12, Issue #89 — CD Workflow: Redeploy `kind` on Push to `main`

*Part of Phase 12 — Local CD & Cluster Observability. See
`docs/ROADMAP.md` Phase 12.*

## Why this came first

Issue #88 gave this project a place to run repo-triggered automation
locally. This issue is what actually uses it: a real Continuous
Deployment workflow that turns "a PR merged to `main`" into "the `kind`
cluster is running that code," automatically, without anyone typing
`docker build` by hand. Every step this workflow runs already existed
as a manual sequence, documented in `wiki/deployment-guide.md` section
4, since Phase 7 — this issue's job wasn't inventing a new deploy
process, it was automating the one already proven to work.

## Key concept: reconciling a real automatic trigger with deliberate, session-scoped execution

The two decisions behind this workflow only make sense together. The
runner is on-demand (issue #88) — nothing executes until a session
starts it. But the CD trigger is a genuine `on: push: branches: [main]`,
not `workflow_dispatch` — a real, automatic trigger, the same kind any
production CD pipeline would use. Combined, a push to `main` queues the
job immediately and unconditionally, and it simply *waits* — sometimes
for seconds, sometimes for the rest of the day — until `./run.sh` is
next started. That's not a compromise forced by the tooling; it's the
intended design. It gives "real" CD semantics (the trigger is genuinely
automatic, not something a human has to remember to invoke) while
keeping code execution on this machine strictly opt-in per session.

A second, smaller design decision worth naming: the workflow only
triggers on pushes touching `api/**`, `web/**`, or `infra/k8s/**` via a
`paths` filter. A docs-only or blog-only merge to `main` — which this
project does constantly, given its branch-and-PR-for-everything
convention — doesn't queue a rebuild at all. Without that filter, every
single documentation PR would queue a pointless multi-minute Docker
build for a cluster whose actual deployed code never changed.

## System design approach

```yaml
# .github/workflows/cd.yml (as of this issue)
on:
  push:
    branches: [main]
    paths:
      - 'api/**'
      - 'web/**'
      - 'infra/k8s/**'

concurrency:
  group: cd
  cancel-in-progress: true

jobs:
  deploy:
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v4
      - name: Build api image
        run: |
          docker build -t interview-insights-api:k8s -f api/Dockerfile \
            --build-arg GIT_SHA=$(git rev-parse --short HEAD) api
      - name: Build web image
        run: |
          docker build -t interview-insights-web:k8s -f web/Dockerfile \
            --build-arg NEXT_PUBLIC_API_URL=http://api.interview-insights.local web
      - name: Load images into kind
        run: |
          kind load docker-image interview-insights-api:k8s interview-insights-web:k8s \
            --name interview-insights
      - name: Apply the dev overlay
        run: kubectl apply -k infra/k8s/overlays/dev
      - name: Roll out api
        run: |
          kubectl -n interview-insights rollout restart deployment/api
          kubectl -n interview-insights rollout status deployment/api --timeout=90s
      - name: Roll out web
        run: |
          kubectl -n interview-insights rollout restart deployment/web
          kubectl -n interview-insights rollout status deployment/web --timeout=90s
```

`concurrency: group: cd, cancel-in-progress: true` matters for the same
reason the on-demand runner does: if two pushes land to `main` before
the runner is next started, only the *latest* one is worth deploying to
a single local cluster — cancelling a stale, still-queued deploy rather
than letting it run after a newer one, or worse, racing it.

The one genuinely new piece of application code this issue added:
`GET /health` gained a `version` field — the short commit SHA, baked
into the image at build time via the `GIT_SHA` build-arg, defaulting to
`"unknown"` for any build that doesn't pass it. Without this, "the
workflow reported success" and "the cluster is actually running the new
code" are two different claims with no way to tell them apart from the
outside.

## Step-by-step: what actually got built and verified

1. **Wrote `cd.yml`** mirroring `wiki/deployment-guide.md` section 4's
   manual sequence exactly — the same commands, just automated.
2. **Added the `GIT_SHA` build-arg** to `api/Dockerfile` and surfaced it
   through `GET /health`, updating `health.controller.spec.ts` and
   `app.e2e-spec.ts` for the new response shape.
3. **Documented the automation** in `wiki/deployment-guide.md` section
   4, directly under the manual steps it replaces.
4. **Merged the PR (#95)** — since the workflow's trigger is a real
   `on: push`, this merge itself queued the first real CD job.
5. **Started the on-demand runner** (`./run.sh --once`) and watched it
   pick up the queued job.
6. **Verified concretely, not just "workflow succeeded"**: after the
   rollout, `GET /health`'s `version` field matched the merge commit SHA
   exactly, and `kubectl get pods` showed freshly restarted `api`/`web`
   pods (`api-54c7c4558f-jh5s8`, `web-79f8dc96d4-49m74`) — proof the
   cluster was actually running the new code, not just that GitHub's UI
   showed a green checkmark.

## What this enabled

A real, working local CD loop: merge a PR, start the runner whenever a
redeploy is actually wanted, and the cluster catches up automatically.
Every subsequent Phase 12 issue builds directly on this — #99 extends
this exact workflow to also provision and seed LocalStack before
rolling out `api`, and #90's cluster-monitoring tooling exists
specifically to watch what this pipeline deploys.
