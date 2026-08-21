# Phase 55, Issue #804 — No `permissions` Block on Any GitHub Actions Workflow

*Part of Phase 55 — Infrastructure, CI/CD & Secrets Hardening.
See `docs/ROADMAP.md` Phase 55.*

## The gap

None of the four workflows (`ci.yml`, `cd.yml`, `cd-hetzner.yml`,
`self-hosted-smoke-test.yml`) declared a `permissions` block. Without
one, GitHub grants the default `GITHUB_TOKEN` scope for the repo —
broader than any of these workflows actually need. `ci.yml` only ever
reads code and runs tests; the two CD workflows authenticate to GHCR via
their own dedicated `HETZNER_GHCR_PAT` repo secret, never
`GITHUB_TOKEN`, for exactly this reason (defense-in-depth already
existed one layer down) — but the workflow-level token itself was still
sitting at its permissive default the whole time, an unnecessary blast
radius if a workflow step were ever compromised (a malicious dependency
in `npm ci`, for instance).

## The fix: `contents: read` everywhere, explicitly

```yaml
# GitHub issue #804 (Phase 55) — defense-in-depth. GHCR auth here goes
# through the dedicated HETZNER_GHCR_PAT repo secret (docker login), not
# GITHUB_TOKEN, so this workflow never needs more than read access to it.
permissions:
  contents: read
```

Added identically to the top level of all four workflow files. None of
them need to write to the repo, open PRs, or touch any other GitHub
API surface via `GITHUB_TOKEN` — `contents: read` (checkout access
only) is the minimum every one of them actually needs, and explicit
rather than relying on whatever the repo's own default happens to be
set to.

## Verification

Each workflow re-run after the change to confirm nothing broke —
`ci.yml`'s test/lint/build steps, both CD workflows' checkout + build +
deploy steps, and the smoke test all continued to pass identically,
confirming none of them were secretly relying on a broader
`GITHUB_TOKEN` permission than `contents: read` provides. A workflow
that *did* need write access (opening a PR, commenting on an issue) would
have failed immediately and loudly at that specific step — none did.
