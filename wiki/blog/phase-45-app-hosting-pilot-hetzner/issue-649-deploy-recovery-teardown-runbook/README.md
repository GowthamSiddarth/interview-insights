# Phase 45, Issue #649 — Runbook: Hetzner Pilot Deploy, Recovery, and Teardown

*Part of Phase 45 — App-Hosting Pilot on Hetzner. See `docs/ROADMAP.md`
Phase 45.*

## The gap this closed

`wiki/deployment-guide.md` is this project's single, exhaustive,
command-by-command runbook — but every section in it, before this
issue, assumed the local `kind` target. The pilot is materially
different: a real VM instead of a disposable local cluster, secrets
from GitHub Actions repo secrets instead of LocalStack, SSH-tunneled
access instead of a bare local `kubectl`, a second CD workflow instead
of `cd.yml`. Without a dedicated section, "how do I redeploy the
pilot" or "the pilot's down, what do I do" had no single place to look.

## Written from the incident it documents, not written first and hoped to be right

Most of this project's runbook sections get written alongside the
feature they describe. This one is different in one important way: its
"recovery from VM loss or recreation" section is a direct transcription
of the real D109/D110 incident this phase actually lived through — an
ARM64 migration attempt that destroyed the VM, failed to recreate it,
and required a full manual restore plus reprovisioning every layer that
had been installed on top of the bare VM (k3s, ingress-nginx,
cert-manager, the TLS cert). Rather than write a hypothetical "what if
this happens" section, the runbook documents the exact sequence that
actually recovered from it, in the exact order those steps' real
dependencies require — k3s before ingress-nginx, the namespace before
cert-manager's `Certificate` resource, DNS/`HETZNER_VM_IP` updated only
if the IP actually changed.

## Structure matches the file's existing convention

Ten subsections, each self-contained and copy-paste runnable: access
model (the SSH tunnel, #668), deploying (`cd-hetzner.yml`, #708),
verifying a deploy actually succeeded (a real external `curl`, not
trusting `kubectl rollout status` alone — the same discipline #648's
own verification used), recovery, the full `HETZNER_*` secrets
inventory (cross-referenced against `docs/SECRETS.md`'s own table so
the two can't silently drift apart), Postgres backup/restore (#663),
k3s upgrade cadence (#666), disk monitoring (#667), known gotchas, and
teardown.

## The gotchas section exists because every one of them actually happened

Five real, hit-live gotchas, each with its concrete fix:

- **The QEMU/SWC segfault** (D109/D111, #761) — `web`'s image build
  crashes under this runner's cross-arch emulation; fixed by a
  dedicated native builder, not application-level tuning.
- **Stale SSH host keys after VM recreation** — `accept-new` doesn't
  save you from a *different* cached key, only a missing one.
- **`kuberc: ... permission denied` noise** on every `kubectl`/`helm`
  call over SSH — cosmetic; an optional preferences file that doesn't
  exist, every real operation still succeeds.
- **Helm config ownership breaking after one `sudo -E helm` call** —
  `-E` preserves `$HOME` while running as root, leaving root-owned
  files under the `deploy` user's own home directory.
- **A prior handoff script's own PR-opening step leaving the shell on a
  stale branch** — several of this phase's own scripts `git checkout
  -b` internally and never return to `main`, which genuinely caused
  confusion mid-session about whether a fix was "really" in a file on
  disk.

## Verification

No code path to test directly — a runbook's own acceptance criteria is
whether the commands in it actually work when followed. Every command
in this section was either copy-pasted from a script already run
successfully earlier in this phase, or (the recovery section
specifically) transcribed from commands that had just recovered the
real pilot from a real incident minutes before being written down.
