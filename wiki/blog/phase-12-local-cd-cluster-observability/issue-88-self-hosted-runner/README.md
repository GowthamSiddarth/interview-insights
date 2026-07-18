# Phase 12, Issue #88 — Register a Self-Hosted GitHub Actions Runner (On-Demand Mode)

*Part of Phase 12 — Local CD & Cluster Observability. See
`docs/ROADMAP.md` Phase 12.*

## Why this came first

Every phase up to this point had produced something real — a Kubernetes
deployment, search, moderation, secrets/IAM — but getting a code change
from a merged PR into the running `kind` cluster was still entirely
manual: rebuild the image, `kind load` it, `kubectl apply`, restart the
rollout, by hand, every time. GitHub Actions can automate that, but
GitHub-hosted runners live on GitHub's infrastructure — they have no
way to reach a `kind` cluster running inside Docker Desktop on a single
laptop. The only way to get a real CD workflow talking to this specific
cluster is to run the workflow's job *on that laptop*. That's what a
self-hosted runner is: GitHub's own agent process, installed locally,
polling GitHub for queued jobs and executing them with access to
whatever the local machine can reach — `docker`, `kind`, `kubectl`, all
of it.

## Key concept: on-demand, not a persistent service, and why that's not just a preference

GitHub's own docs describe two ways to run a self-hosted runner:
`svc.sh install`, which registers it as an always-on system service
that starts at boot, or manually invoking `./run.sh` (optionally
`--once`, which processes exactly one queued job and exits). The user's
explicit decision here was on-demand: nothing repo-triggered executes
on this machine unless a session deliberately starts the runner first.
That's a real security boundary, not just tidiness — a persistent
runner service means *any* push to `main` (from any collaborator,
eventually, if this repo ever grows past solo use) can execute
arbitrary workflow-defined shell commands on this specific laptop,
unattended, at any hour. On-demand mode means the worst case is bounded
to whatever's queued at the exact moment `./run.sh` is manually
started — a deliberate, session-scoped trust boundary instead of a
standing one. The tradeoff is explicit too: a push to `main` doesn't
redeploy immediately, it just queues until someone chooses to run the
runner. Issue #89's CD workflow is designed around exactly this queuing
behavior rather than fighting it.

## System design approach

Registration is one-time, using GitHub's own runner registration-token
flow scripted through `gh`:

```bash
mkdir -p ~/workspace/actions-runner-interview-insights
cd ~/workspace/actions-runner-interview-insights
curl -o runner.tar.gz -L "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-osx-arm64-${RUNNER_VERSION}.tar.gz"
tar xzf runner.tar.gz

TOKEN=$(gh api -X POST repos/GowthamSiddarth/interview-insights/actions/runners/registration-token --jq '.token')
./config.sh --url https://github.com/GowthamSiddarth/interview-insights \
  --token "$TOKEN" --name "interview-insights-local" \
  --labels "self-hosted,macOS,local-kind" --work "_work" --unattended
```

The runner is installed as a sibling of the repo, never inside it — its
own `_work/` directory does its own `git checkout` of `interview-insights`
per job, and it carries credential files (`.credentials`,
`.credentials_rsaparams`) that have no business anywhere near a tracked
git tree. See `wiki/deployment-guide.md` section 7 for the full
rationale.

Verification needed its own workflow, deliberately separate from the
real CD pipeline:

```yaml
# .github/workflows/self-hosted-smoke-test.yml
on:
  workflow_dispatch: {}

jobs:
  smoke-test:
    runs-on: self-hosted
    steps:
      - run: echo "self-hosted runner is alive"
      - run: uname -a
      - run: docker info --format '{{.ServerVersion}}'
      - run: kubectl config current-context
```

## Step-by-step: what actually got built and verified

1. **Registered the runner** via the `gh api` registration-token flow
   above, labeled `self-hosted,macOS,local-kind` so future workflows can
   target it precisely if this project ever adds a second runner.
2. **Added the smoke-test workflow**, `workflow_dispatch`-only so it
   never fires on a real push — its only job is answering "is the
   runner alive and correctly configured," independent of whatever the
   real CD workflow (#89) does.
3. **Hit an ordering gotcha immediately**: `workflow_dispatch` only
   targets workflows that already exist on the default branch — a
   workflow file sitting uncommitted, or only on a feature branch,
   simply isn't dispatchable yet. The smoke-test workflow had to be
   merged to `main` *before* it could be manually triggered at all.
4. **First dispatch failed** on the `kubectl config current-context`
   step — an unrelated, pre-existing local kubeconfig issue (no context
   was set as current), not anything to do with the runner itself. Fixed
   with `kubectl config use-context kind-interview-insights`.
5. **Second dispatch passed all four steps** — confirming Docker and
   `kubectl` were both reachable from a job actually executed by the
   local runner process, not just theoretically configured to be.
6. **Confirmed on-demand behavior concretely**: after `./run.sh --once`
   processed the queued smoke-test job, the runner process exited on
   its own, and `gh api repos/:owner/:repo/actions/runners` showed it
   `offline` again — the expected steady state for this mode, not a
   fault condition.

## What this enabled

A verified, reachable execution environment for repo-triggered
automation on this specific machine — the load-bearing prerequisite for
issue #89's real CD workflow, which assumes exactly this runner exists,
is occasionally started, and can reach `docker`/`kind`/`kubectl`
without any further setup.
