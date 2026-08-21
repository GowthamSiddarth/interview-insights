# Phase 55, Issue #807 — LocalStack Image Pinned Off :latest

*Part of Phase 55 — Infrastructure, CI/CD & Secrets Hardening.
See `docs/ROADMAP.md` Phase 55.*

## The gap

`infra/k8s/base/localstack/08-localstack.yaml` pulled
`localstack/localstack:latest`. A floating tag means the exact image
that gets pulled depends entirely on *when* the pull happens — a kind
cluster bootstrapped today and one bootstrapped next month could
silently run different LocalStack versions, with no record anywhere of
which one either environment actually got. If a new `:latest` ever
shipped a breaking change to IAM/Secrets Manager emulation behavior,
the failure would show up as a confusing, environment-specific bug with
no obvious cause — "it works on my machine" in its most literal form.

## The fix: a real version tag

```yaml
image: localstack/localstack:2026.07.5
```

The specific version chosen was whatever `:latest` currently resolved
to at the time — pinning doesn't mean picking an arbitrary older
version, it means locking in a known-good one and making every future
upgrade a deliberate, reviewable change (a version bump in a PR) instead
of an invisible one that happens automatically on the next pod restart.

## Verification

A full kind-cluster bootstrap from scratch with the pinned tag,
confirming LocalStack starts cleanly and every existing IAM/Secrets
Manager integration test still passes against the pinned version —
proving the specific version chosen is actually compatible with this
project's usage, not just "the most recent one that happened to work."
