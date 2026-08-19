# Phase 46, Issue #708 — Build `cd-hetzner.yml`

*Part of Phase 46 — Hetzner Pilot: Reachability & Operational Hardening.
See `docs/ROADMAP.md` Phase 46, Track A, and `docs/DECISIONS.md` D105.*

## The gap this closed

`#665` decided a CD job was the right shape; this issue is that job. A
second CD workflow alongside the existing `cd.yml` (kind/local target),
not a replacement — different runner requirements, different secret
provisioning, a genuinely different deploy target.

## `workflow_dispatch`, not automatic on push

Every image/overlay change in this project's history has triggered
`cd.yml` automatically. `cd-hetzner.yml` deliberately doesn't — this is
the only environment this project has ever run that's actually on the
public internet, single replica per service, no staging buffer in
front of it. Automating the trigger is a reasonable thing to revisit
once the pilot's proven stable; starting manual matched this whole
phase's own pattern of proving each layer live before trusting it
(staging cert before production, in #662).

## Every pilot secret provisioned by the workflow itself (D105)

D102 (Phase 45, #647) originally scoped every pilot secret as
manually-provisioned Pattern B, specifically because no CD workflow
reached this environment yet. This issue is exactly what changed that
premise — D105 supersedes D102's manual-sourcing half: every
`HETZNER_*` GitHub Actions repo secret gets provisioned as a real k8s
Secret on every run:

```bash
kubectl create secret generic api-secrets \
  --namespace interview-insights \
  --from-literal=DATABASE_URL="$DATABASE_URL" \
  --from-literal=EMAIL_HASH_SECRET="$EMAIL_HASH_SECRET" \
  --from-literal=MAIL_SMTP_PASSWORD="$MAIL_SMTP_PASSWORD" \
  ...
```

`ANTHROPIC_API_KEY` stays genuinely optional — an unset repo secret
just deploys `review-analyzer` with AI moderation triage disabled, the
same "absent, not empty" rule `docs/SECRETS.md` already documents for
every other environment's equivalent case.

## Provisioning `HETZNER_*` secrets themselves, safely

Seven secrets needed real values before the workflow could run for the
first time — generated locally with `openssl`/`bcryptjs`, matching this
project's exact format requirements (`EMAIL_ENCRYPTION_KEY` as a
64-hex-char AES-256 key, `DATABASE_URL`'s password percent-encoded per
D92's own gotcha), and set via `gh secret set` one at a time, idempotent
against ones already set:

```bash
already_set() { echo "$EXISTING" | grep -qx "$1"; }
set_secret() {
  if already_set "$1"; then echo "$1: already set, skipping."
  else printf '%s' "$2" | gh secret set "$1"; fi
}
```

## Same disk-pressure discipline as `cd.yml`

The self-hosted runner is a single, persistent machine — the exact
shared-disk failure mode D85/D86/D87 already documented for `cd.yml`
applies here too, so the same pre-flight gate and post-run Podman
pruning steps carried straight over rather than being reinvented.

## The tunnel, reused rather than duplicated

`infra/scripts/hetzner-pilot-tunnel.sh` (#668) already existed as a
standalone operator tool; `cd-hetzner.yml` calls it directly rather
than re-implementing SSH-tunnel logic inline — one script, two
consumers (a human running it interactively, and this workflow running
it in CI), kept in sync by construction rather than by discipline.

## Verification

The workflow's own first real runs are the actual story here — six
attempts, five distinct bugs found and fixed (`HETZNER_VM_IP` missing
from the CI checkout, image architecture mismatch, the `web`-build QEMU
segfault, a stale SSH host key, a bare VM after an unrelated
architecture-migration incident) before the sixth run succeeded end to
end and #648's own external `curl` check confirmed the deploy for real.
See that issue's post for the full run-by-run account, and #761's for
the QEMU segfault specifically.
