# Phase 46, Issue #761 — `web` Image Build Segfaults Under QEMU Cross-Arch Emulation

*Part of Phase 46 — Hetzner Pilot: Reachability & Operational Hardening.
See `docs/ROADMAP.md` Phase 46, and `docs/DECISIONS.md` D109/D110/D111.*

## The gap this closed

The first real `cd-hetzner.yml` run (#708) got every image building and
pushing after fixing an architecture-mismatch bug — `api`/
`notification-service`/`review-analyzer` all built fine under
`--platform linux/amd64` emulation on this project's Apple Silicon
self-hosted runner. `web`'s Next.js production build didn't:

```
qemu: uncaught target signal 11 (Segmentation fault) - core dumped
Next.js build worker exited with code: null and signal: SIGSEGV
```

Reproducible every time, inside SWC — Next.js's native Rust compiler.
This issue is the real debugging trail that led to a fix, not a guess
that happened to work.

## Four application-level workarounds tried and ruled out

Every one of these was verified live against a locally reproduced
crash before being ruled out — not guessed and shipped blind.

**`--cpus=1`** (a CPU time quota): delayed the crash to a later build
phase (`Collecting page data` instead of `Creating an optimized
production build`) but didn't prevent it.

**`--cpuset-cpus=0`** (core pinning): no effect at all — Node's
`os.cpus()` still reported all 5 host cores regardless, since it reads
`/proc/cpuinfo` directly rather than respecting cgroup/cpuset
restrictions on this system.

**`experimental.cpus: 1`** in `next.config.mjs` (Next.js's own
worker-pool size control, independent of OS-reported core count): no
improvement — crashed even sooner than the baseline.

**A `.babelrc` forcing Babel instead of SWC** (sidesteps the native
Rust binary entirely): blocked outright. `next/font` — used in
`layout.tsx` — hard-requires SWC; Next.js refuses to build rather than
silently degrade.

## A fifth attempt, with real monitoring data this time

Before reaching for infrastructure, one more lever: memory pressure.
Live-monitored via `free -m` on the podman machine during a
reproduction —

```
09:56:17   available: 3797
09:56:38   available: 3189
09:56:59   available: 3017
```

— free memory dropped steadily through the whole build, a real
correlation worth testing properly rather than dismissing. The podman
machine got bumped from 8 GB to 12 GB and the build re-run:

```
✓ Compiled successfully in 49s
   Linting and checking validity of types ...
   Collecting page data ...
qemu: uncaught target signal 11 (Segmentation fault)
```

Compilation itself succeeded this time — real progress — but the crash
still happened, at the next phase, with memory usage never exceeding
~2 GB the entire run. That disproves memory exhaustion as the root
cause: more headroom shifted *when* the crash happened, not *whether*
it happened, the same pattern `--cpus=1` had already shown. Consistent
with a genuine timing/race-condition bug in QEMU's TCG (its JIT) under
SWC's heavy multi-threaded native code — not tunable from the
application or VM-resourcing side.

## The detour: an ARM64 VM migration, tried and reverted the same day

Before landing on the eventual fix, the more direct-seeming option got
a real attempt: migrate the whole pilot VM to ARM64 (Hetzner's CAX
line), matching the self-hosted runner's own Apple Silicon architecture
and eliminating cross-arch emulation entirely, for every future build,
not just this one. `terraform apply -replace=hcloud_server.this` with
`server_type = "cax21"` destroyed the existing VM successfully — then
recreation failed:

```
Error: unsupported location for server type (invalid_input)
```

The earlier availability check (`/v1/server_types`, which lists a
server type's *global* price entries) had confirmed `cax21` carried
`nbg1` pricing — but a priced entry isn't the same claim as "actually
provisionable here right now." The correct check, `/v1/datacenters`
cross-referenced against `cax21`'s own numeric ID, found it only
actually available in `ash-dc1`/`hil-dc1` (US), not this pilot's own
Nuremberg datacenter. With the VM already destroyed and the pilot fully
down, it was restored first (`cx33`, same IP, no `-replace` needed)
before deciding anything else — then, given a real choice rather than
deciding under active-outage pressure, the call was to revert cleanly
rather than relocate the whole pilot to a different continent to chase
one build's architecture match.

## The fix: a genuinely native builder, not a fixed emulator

```yaml
build-web-image:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - name: Build & push web image
      run: |
        docker build -t "$IMG" -f web/Dockerfile \
          --build-arg NEXT_PUBLIC_API_URL=https://api.interviewinsights.fyi web
        docker push "$IMG"

deploy:
  needs: build-web-image
  runs-on: [self-hosted, macOS, local-kind]
  # ... builds the other three images under emulation, which works fine for them
```

Genuinely native x86_64 hardware sidesteps the whole class of bug — no
emulation, nothing to segfault. GitHub-hosted, not self-hosted: this
project's existing self-hosted-runner decision (D82) was driven by a
billing gate from *automatic, per-push* CI minutes and a private-repo
security posture (no fork-PR attack surface, since this repo has no
external contributors) — neither concern applies to one occasional job
in a `workflow_dispatch`-only workflow. Plain `docker`, not `podman`:
`ubuntu-latest` ships it preinstalled, and introducing podman for one
job wasn't worth it.

## Verification

The real test wasn't a passing CI check in isolation — it was the next
full `cd-hetzner.yml` run succeeding end to end, `build-web-image`
completing cleanly with no emulation involved, followed by #648's own
external `curl` confirming the deployed result actually serves real
traffic. Both happened on the very next run after this fix landed.
