# Phase 13, Issue #106 — CI Validation for infra/k8s Manifests and Dockerfiles

*Part of Phase 13 — Local Infra Hardening & Reproducibility. See
`docs/ROADMAP.md` Phase 13.*

## Why this came first

By the end of Phase 12, `ci.yml` had three jobs — `api`, `web`,
`workers` — each lint/build/test-ing its own codebase on every PR. What
it never touched was `infra/`: a broken `kustomization.yaml` edit or a
broken Dockerfile line would sail through CI green, because nothing in
CI ever actually parsed a Kustomize overlay or built a Docker image.
The only place either would surface was the self-hosted runner's real
CD job (#89/#99), applying that same manifest against the live `kind`
cluster — a late, expensive place to discover a YAML typo, and one that
depends on someone remembering to start the runner before the mistake
is even visible. This issue closes that gap the same way `api`/`web`
already closed it for application code: catch the regression at PR
time, on infrastructure GitHub already provides for free.

## Key concept: validating a Kustomize overlay doesn't require a cluster

The intuitive assumption is that "does this manifest work" requires a
real Kubernetes API server to apply it against. It doesn't — Kustomize's
entire job is producing a fully-rendered manifest from a set of
resources, bases, and patches, and `kubectl kustomize <dir>` does
exactly that render without ever touching a cluster. If the overlay's
YAML is malformed, a patch references a resource that doesn't exist, or
a load-restriction rule is violated (the exact class of bug issue #78's
own blog post hit), `kubectl kustomize` fails loudly and immediately.
That means this validation could run entirely on a GitHub-hosted
runner — no `kind`, no self-hosted runner, no cluster at all — which is
exactly what makes it cheap enough to run on every single PR rather
than being reserved for the occasional manual check.

## Key concept: a Docker build is also a build-only check, not a deploy

The same reasoning applies to the Dockerfiles: `docker build` alone
proves the image *compiles* — every `COPY`, every `RUN npm ci`, every
multi-stage `COPY --from=build` reference resolves and the final image
exports successfully. It says nothing about whether the image behaves
correctly at runtime (that's what `cd.yml` actually rolling it out onto
`kind` proves), but a huge class of regressions — a typo'd path, a
missing `RUN` step, exactly the class of bug D-numbered decisions in
this project have already hit more than once (the Phase 6 `npx prisma
generate` bug, the Phase 7 `NEXT_PUBLIC_API_URL` build-time bug) — never
needs a running container to catch. GitHub-hosted `ubuntu-latest`
runners ship with Docker preinstalled, so this needed zero extra setup
beyond the build commands themselves.

## System design approach

```yaml
# .github/workflows/ci.yml — new job, alongside api/web/workers
infra:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: azure/setup-kubectl@v4
      with:
        version: 'v1.31.0'
    - name: Validate Kustomize overlays build cleanly
      run: |
        for overlay in dev dev-localstack staging prod; do
          echo "== infra/k8s/overlays/$overlay =="
          kubectl kustomize "infra/k8s/overlays/$overlay" > /dev/null
        done
    - name: Build api image (validation only, no push/run)
      run: docker build -t interview-insights-api:ci-check -f api/Dockerfile api
    - name: Build web image (validation only, no push/run)
      run: |
        docker build -t interview-insights-web:ci-check -f web/Dockerfile \
          --build-arg NEXT_PUBLIC_API_URL=http://api.interview-insights.local web
```

`azure/setup-kubectl` pins an exact `kubectl` version rather than
relying on whatever happens to ship in the `ubuntu-latest` image at any
given time — GitHub's runner images do change their preinstalled tool
versions over time, and pinning removes that as a source of a CI run
suddenly behaving differently with no code change at all.

All four overlays get validated, not just `dev` — `dev-localstack` is
CD's actual deploy target as of issue #99, and `staging`/`prod` are
real, if currently undeployed, Kustomize output that should stay
buildable even while gated on a Phase 8 trigger.

## Step-by-step: what actually got built

1. **Verified every check locally first**, before writing a line of
   workflow YAML: `kubectl kustomize` against all four overlays, and
   `docker build` for both Dockerfiles with the exact same commands the
   CI job would use — all passed, confirming the job would be
   validating real state, not chasing a hypothetical.
2. **Added the `infra` job** to `ci.yml`, deliberately not sharing the
   `api`/`web` jobs' Postgres/OpenSearch service containers — this job
   needs neither, so it stays fast and simple.
3. **Documented the new job** in `wiki/deployment-guide.md` section 8,
   right where the CD walkthrough already explains what happens after a
   merge — noting explicitly that this now runs *before* any of those
   steps, at PR time.
4. **Let the PR prove itself**: this issue's own pull request was the
   first real run of the new `infra` job — watching it pass directly
   confirmed the job works correctly on GitHub's actual infrastructure,
   not just in a local approximation of it.

## What this enabled

A broken Kustomize overlay or Dockerfile now fails a PR check the same
way a broken unit test does — visible immediately, blocking merge by
convention, and never dependent on someone remembering to start the
self-hosted runner before the mistake becomes obvious. It also set up
the exact verification method issue #108 needed next: knowing the
overlays and images build cleanly in isolation made it possible to
narrow that issue's real failure down to a runtime ordering bug, not a
manifest syntax problem.
