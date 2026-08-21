# Phase 55, Issue #809 — GHCR PAT Reused for Both Push and Pull-Secret Roles

*Part of Phase 55 — Infrastructure, CI/CD & Secrets Hardening.
See `docs/ROADMAP.md` Phase 55, `docs/DECISIONS.md` D105.*

## The gap

`cd-hetzner.yml`'s `HETZNER_GHCR_PAT` repo secret did double duty:
`docker login`-ing to push the `api`/`web` images, *and* getting baked
directly into the cluster as `ghcr-pull-secret`'s credential so pods
could pull those same images back down. The push role genuinely needs
`write:packages`. The pull-secret role only ever needs `read:packages`
— but since it was the same token, the pull secret sitting on the
cluster carried the full write scope too. Anyone with read access to
that k8s Secret (cluster access, or a compromised pod mounting it) got
a credential that could also push and overwrite images in the registry,
not just pull existing ones — a wider blast radius than a pull secret
should ever carry.

## The fix: two tokens, one write-scoped and confined to CI, one read-only and the only one that reaches the cluster

```yaml
# "Provision ghcr-pull-secret" step
# GitHub issue #809 (Phase 55) — HETZNER_GHCR_PULL_PAT is a separate,
# read:packages-only PAT, used only here; the write-scoped token never
# leaves GitHub Actions secrets.
env:
  GHCR_PULL_PAT: ${{ secrets.HETZNER_GHCR_PULL_PAT }}
run: |
  if [ -z "$GHCR_PULL_PAT" ]; then
    echo "::error::HETZNER_GHCR_PULL_PAT is not set - see wiki/deployment-guide.md 12.5."
    exit 1
  fi
  kubectl create secret docker-registry ghcr-pull-secret \
    --docker-server=ghcr.io \
    --docker-username=GowthamSiddarth \
    --docker-password="$GHCR_PULL_PAT" \
    --dry-run=client -o yaml | kubectl apply -f -
```

`HETZNER_GHCR_PAT` (write-scoped) is untouched and keeps doing exactly
what it did before — `docker login` for the two image-push steps,
never reaching the cluster. The new `HETZNER_GHCR_PULL_PAT` is a
second, `read:packages`-only classic PAT — GitHub's API has no endpoint
to mint one programmatically, so creating it is necessarily a manual,
web-UI step, documented directly in the deployment guide rather than
scripted.

The hard-fail-if-unset guard matters as much as the token split itself:
a silent fallback to the write-scoped token if the new secret were ever
missing would quietly defeat the entire fix the moment someone forgot to
set it — exactly the same "fail loud, never fall back to something less
safe" pattern this workflow already used for
`HETZNER_POSTGRES_PASSWORD`.

## Verification

CI green on the workflow change itself confirms the YAML is valid and
the guard fires correctly for a missing secret in principle, but the
real verification only happens on the next actual `cd-hetzner.yml` run
against the live pilot — the new `HETZNER_GHCR_PULL_PAT` has to
actually exist as a repo secret before that run, or the "Provision
ghcr-pull-secret" step hard-fails the deploy by design. Confirmed set
before merging, and the subsequent real deploy pulled images
successfully using only the narrower, read-only credential.
