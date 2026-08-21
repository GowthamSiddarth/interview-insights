# Phase 56, Issue #815 — Confirm COOKIE_SECURE=true Now That Hetzner TLS Is Live

*Part of Phase 56 — Frontend & UX Hardening.
See `docs/ROADMAP.md` Phase 56, Phase 45/46 (real trusted TLS via cert-manager).*

## The question

`getSessionCookieOptions()`'s `COOKIE_SECURE` env var controls whether
session cookies get the `Secure` attribute — correct only once the
serving environment is actually terminated over real HTTPS. Phase
45/46 landed cert-manager-issued trusted TLS on the Hetzner pilot after
this value was originally set for that environment. The audit flagged
it as worth re-checking: did the pilot's config actually get flipped to
`"true"` once TLS went live, or is it still sitting at the pre-TLS
`"false"` default from before the pilot had real certificates?

## The finding: already correct

`infra/k8s/overlays/hetzner-pilot/api-config-patch.yaml` already had
`COOKIE_SECURE: "true"` — confirmed correct, no code change needed.
Recorded directly at the source rather than left as tribal knowledge:

```yaml
# Re-confirmed correct by GitHub issue #815 (Phase 56) — still "true" here.
```

Genuinely a verification issue, not a fix — the value was set correctly
when TLS actually landed; this issue exists to close the loop and leave
a paper trail confirming someone actually checked, rather than assuming
it was right and moving on.

## Verification

Read the live config directly rather than trusting memory of when it
was last touched, and cross-checked against Phase 45/46's own
cert-manager work to confirm the TLS cutover and this value's
correctness genuinely align in time — a `COOKIE_SECURE: "true"` set
*before* real TLS existed would have been silently breaking session
cookies over plain HTTP, the opposite failure mode from the one this
issue was checking for.
