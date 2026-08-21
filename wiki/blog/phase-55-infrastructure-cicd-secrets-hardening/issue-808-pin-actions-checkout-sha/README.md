# Phase 55, Issue #808 — Third-Party Actions Not Pinned to Commit SHAs

*Part of Phase 55 — Infrastructure, CI/CD & Secrets Hardening.
See `docs/ROADMAP.md` Phase 55.*

## The gap

`cd.yml` and `cd-hetzner.yml` — the two credential-bearing deploy
workflows, the ones with real access to `HETZNER_GHCR_PAT` and every
other production secret — referenced `actions/checkout@v4`. A version
tag like `v4` isn't immutable: it's a mutable git ref that the action's
maintainer (or, in a supply-chain-compromise scenario, an attacker who's
gained control of that repo) can repoint to a different commit at any
time. Every future run of these workflows would silently pull whatever
`v4` happens to point to *then*, not what it pointed to when this
workflow was last reviewed — a real, if narrow, supply-chain attack
surface on exactly the two workflows that can reach production
credentials.

## The fix: pin to the exact commit, keep the version as a comment

```yaml
- uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
```

The commit SHA was fetched directly from GitHub's API (`gh api
repos/actions/checkout/git/refs/tags/v4` and following it to its commit)
— this is exactly what `v4` resolved to at the time of the fix, not an
arbitrary older commit. The `# v4` trailing comment keeps the
human-readable version visible for anyone scanning the workflow file,
without reintroducing the mutability a bare tag reference carries. Only
applied to `cd.yml`/`cd-hetzner.yml` — the two workflows that touch real
deploy credentials — not `ci.yml`/`self-hosted-smoke-test.yml`, which
never see production secrets and carry correspondingly lower stakes for
this particular class of risk.

## Verification

Both workflows re-run after pinning, confirming the checkout step still
resolves correctly and every downstream step (build, push, deploy)
continued to work identically — a wrong or stale SHA would have failed
the checkout step itself immediately, not silently degraded something
later.
