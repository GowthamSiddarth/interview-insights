# Phase 13, Issue #108 — Adversarial Verification: Rebuild the kind Cluster From Scratch

*Part of Phase 13 — Local Infra Hardening & Reproducibility. Depends on
issue #107. See `docs/ROADMAP.md` Phase 13.*

## Why this came first

The local `kind` cluster had been running continuously since Phase 7 —
pods showing uptimes in the days, not hours, across many sessions of
work in Phases 8-12. Every one of those phases' verifications ran
against that same long-lived cluster: applying an overlay, restarting a
single deployment, port-forwarding to check a service. None of them
ever actually destroyed the cluster and proved it comes back up clean
from nothing. "It's been running fine for weeks" and "it reproducibly
bootstraps from zero" are different claims — the same distinction D22
already drew once, about secrets wiring specifically. This issue exists
to test the second claim directly, adversarially, the same pattern
issue #80 used for LocalStack: don't assume reproducibility, break the
thing on purpose and watch what happens.

## Core concept: a long-lived environment quietly accumulates untested assumptions

Every earlier Phase 11/12 verification that touched `api` did so by
restarting an *already-running* pod — `kubectl rollout restart
deployment/api` against a Deployment that had booted successfully at
some point in the past and simply needed to pick up a new image or
config value. That's a completely different code path from a pod
starting for the very first time on a cluster with nothing seeded yet.
Nobody had exercised that path since Phase 11 first built it, because
nobody had actually deleted the cluster since. The bug this issue found
was sitting there, invisible, for that entire time — not because
anyone made a mistake reviewing it, but because the specific condition
that triggers it (LocalStack existing with zero seeded secrets, and
`api` trying to boot against it) simply never occurred in a
continuously-running environment.

## The bug this found: two "wait for ready" checks with an ordering dependency between them

`infra/scripts/bootstrap-kind.sh` (issue #107) originally had a single
step: `kubectl wait --for=condition=ready pod --all --timeout=180s`,
covering every pod in the namespace, immediately after applying the
overlay and before seeding LocalStack. On a fresh cluster, `api`'s
container entrypoint (`api/scripts/entrypoint.js`, built in issue #79)
calls `bootstrapSecretsFromLocalStack()` as its first action — fetching
`DATABASE_URL`/`EMAIL_HASH_SECRET` from LocalStack Secrets Manager
before anything else runs. On a cluster where LocalStack has never been
seeded, that fetch fails outright:

```
ResourceNotFoundException: Secrets Manager can't find the specified secret.
    at async fetchSecret (/app/dist/secrets/localstack-secrets-bootstrap.js:40:22)
    at async bootstrapSecretsFromLocalStack (/app/dist/secrets/localstack-secrets-bootstrap.js:32:44)
```

`api` crash-loops immediately, and `kubectl wait --for=condition=ready
pod --all` times out waiting for it — but the *fix* (seeding LocalStack)
was the very next step in the script, one that could never run because
the wait before it never returned. A deadlock between two steps that
each looked correct in isolation.

## System design approach: match the ordering that already worked

`cd.yml` (issues #89/#99) never had this bug, because it was never
written to wait on every pod up front — it explicitly waits only on
`localstack`, seeds it, and only then rolls `api` out with its own
dedicated wait. The fix for the bootstrap script was bringing it into
line with that same shape rather than inventing a new one:

```bash
# Before (issue #107's original version): waits on api too early
kubectl -n "$NAMESPACE" wait --for=condition=ready pod --all --timeout=180s

# After: excludes api explicitly, matching cd.yml's proven ordering
kubectl -n "$NAMESPACE" wait --for=condition=ready pod -l app=postgres --timeout=180s
kubectl -n "$NAMESPACE" wait --for=condition=ready pod -l app=opensearch --timeout=180s
kubectl -n "$NAMESPACE" wait --for=condition=ready pod -l app=localstack --timeout=180s
kubectl -n "$NAMESPACE" wait --for=condition=ready pod -l app=web --timeout=180s

# ...seed LocalStack here...

kubectl -n "$NAMESPACE" rollout restart deployment/api
kubectl -n "$NAMESPACE" rollout status deployment/api --timeout=90s
```

`api` isn't waited on until *after* the thing it depends on at boot
actually exists — the same lesson D22 already recorded once, about
`process.env` needing to be mutated before the thing reading it is
constructed, showing up again one layer down the stack: a pod can't
reach `Ready` on a dependency that isn't there yet, no matter how long
the timeout is set to.

## Step-by-step: what actually got built and verified

1. **Snapshotted the live cluster's state first** — `kubectl get
   pods`/`get pvc`, pods showing multi-day uptimes — as the honest
   "before" picture this issue was questioning.
2. **Destroyed it for real**: `kind delete cluster --name
   interview-insights`, confirmed with `kind get clusters` returning
   nothing.
3. **Ran `bootstrap-kind.sh` against the empty state** — and it failed:
   `api`/`localstack`/`opensearch`/`postgres`/`web` all timed out
   waiting for ready, exit code 1. This alone was the adversarial
   check's first real finding: the "one-shot bootstrap" from issue #107
   had never actually been tested from true zero, only against an
   already-running cluster.
4. **Diagnosed the actual failure**, not just the timeout symptom —
   `kubectl describe`/`kubectl logs --previous` on the crash-looping
   `api` pod surfaced the exact `ResourceNotFoundException`, pointing
   straight at the wait-ordering bug above.
5. **Fixed the script** (see above), then **re-ran the full destroy
   → rebuild cycle again** against the still-broken cluster left over
   from step 3 — confirming the fix resolves it, not just that it looks
   plausible: exit code 0, all 5 pods `Ready`, both PVCs `Bound`.
6. **Ran the complete golden path** through the real Ingress-fronted
   `web`/`api` on the freshly-rebuilt cluster: created a company,
   candidate, interview process, round, and rating (came back
   `pending`, per CLAUDE.md hard constraint #2); approved it via
   moderation; confirmed it now public; refreshed the materialized
   view; confirmed the analytics endpoint and both search endpoints
   (companies, reviews) found it.
7. **Verified LocalStack was genuinely in use, not just reachable** —
   same technique as issue #99: compared a real candidate's stored
   `email_hash` against an HMAC computed with both possible secret
   values. Only the LocalStack-seeded secret's hash matched.
8. **Confirmed `web` and `metrics-server` both survived the rebuild
   correctly**: homepage and `/search` both `200`, `kubectl top pods`
   returning real numbers again post-rebuild.
9. **Documented the gotcha** in `wiki/deployment-guide.md` section 3,
   directly alongside the bootstrap script's fast-path note.

## What this enabled

Proof, not assumption, that the local environment this project has
built across thirteen phases can be destroyed and rebuilt cleanly on
demand — and a concrete demonstration of why that proof matters: a real
bug had been sitting in freshly-written infrastructure code for exactly
as long as nobody had tested the one condition that triggers it. The
same pattern (destroy something on purpose, rebuild it, verify the
*actual* end-to-end behavior rather than trusting a green exit code) is
now a repeatable technique this project has used three times —
LocalStack secrets (#80), the CD pipeline (#89), and now the cluster
itself — worth reaching for again whenever "it's been working" needs to
become "it's been proven to work."