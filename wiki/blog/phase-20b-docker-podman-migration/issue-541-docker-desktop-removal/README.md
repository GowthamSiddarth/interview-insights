# Phase 20b, Issue #541 — Proving It Works Absent, Then Actually Removing It

*Part of Phase 20b — Docker → Podman Migration. See `docs/ROADMAP.md`
Phase 20b and `docs/DECISIONS.md` D93.*

## The gap #540 deliberately left open

The previous post ended on a specific, narrow distinction: #540 proved
the full stack works with Docker Desktop *unused* — installed, present,
but nothing in the migrated pipeline actually calling it. That's not the
same claim as the stack working with Docker Desktop *absent* entirely.
D91's own 80/443 parity confirmation ran with Docker Desktop still
installed. This issue exists to close that specific gap: prove the whole
stack survives with it gone, then actually remove it.

That distinction matters because of a caveat all the way back in the
first post of this phase (#496, D83): Podman's Compose support isn't a
real reimplementation, it's a dispatcher that shells out to whatever
Compose-spec-compatible binary is on `PATH` — and on this machine, that
had been Docker Desktop's own bundled `docker compose` v2 plugin the
whole time. Uninstalling Docker Desktop without checking that dependency
first would have silently broken `podman compose`, several posts and
several fixed bugs after the fact.

## Key concept: verify before you remove, not after

The order of operations here is the whole point. Before touching
anything, this issue confirmed the existing `interview-insights` kind
cluster (rootful `podman-machine-default`, 8GiB/5 CPU per #540) was
already healthy — all 9 pods `Running` — as an honest starting baseline.
Then it ran the golden-path smoke test
(`api/test/golden-path.smoke-spec.ts`, `npm run smoke:e2e`) *with Docker
Desktop already not running*, to see what would actually break.

It failed — but not for the reason this issue was testing. Two real,
pre-existing gaps surfaced, neither one caused by Docker Desktop's
absence:

- **Gap 1:** `infra/scripts/dev-port-forwards.sh start` had never been
  run for this session, so nothing was listening on `localhost:5432`/
  `9200`/etc. Not a regression — the verification just skipped a
  documented prerequisite. Fixed by running it; the port-forward script
  is idempotent and safe to always call before the smoke test.
- **Gap 2:** `interview_insights_test` had never actually been created on
  this specific cluster's Postgres instance.
  `wiki/deployment-guide.md`'s own section already documents `kubectl
  exec postgres-0 -- psql -U postgres -c "CREATE DATABASE
  interview_insights_test;"` plus `prisma migrate deploy` as a one-time
  step per cluster — this cluster just hadn't had it run yet.

Both gaps got fixed as part of getting to a real baseline, then the smoke
test ran again — clean, with Docker Desktop still not running. That's the
discipline worth calling out here: a naive read of "smoke test failed
right after quitting Docker Desktop" would have pointed straight at the
migration as the cause. Actually reading the failures showed neither one
had anything to do with it.

## Key concept: "not running" and "not installed" are different claims worth testing separately

With both real gaps closed, the actual verification sequence ran clean,
in order: `quit app "Docker"` confirmed not running → `kubectl get
nodes`/`get pods` still all healthy → `curl
http://app.interview-insights.local/` and `curl
http://api.interview-insights.local/health` both reachable — 80/443
parity, this time with Docker Desktop genuinely absent from the running
process list, not just unused as in #540 → the golden-path smoke test,
**15 of 15 passing**.

Only with that green did the actual removal happen:
`brew uninstall --cask docker`.

## Key concept: a `sudo` prompt doesn't disappear just because a session is non-interactive

The first uninstall pass left two root-owned leftovers behind —
`/Applications/Docker.app` and
`/Library/PrivilegedHelperTools/com.docker.socket` — because `brew`'s
underlying `sudo` call needs an interactive password prompt that a
non-interactive session can't supply. The launchd services themselves
(`com.docker.helper`, `com.docker.socket`, `com.docker.vmnetd`) were
removed automatically without issue; it was specifically the two
filesystem paths requiring elevated permissions that stalled. Finishing
those two removals needed the user to re-run the exact same `brew
uninstall --cask docker` command themselves, once, interactively — a
small but real reminder that automation boundaries around `sudo` aren't
just a formality.

## Step-by-step: what actually got verified and removed

1. Confirmed the existing cluster's baseline health — all 9 pods
   `Running` — before changing anything.
2. Ran the golden-path smoke test with Docker Desktop already quit, as a
   baseline read on the real starting state.
3. Diagnosed both real, unrelated gaps it surfaced (port-forwards not
   started, `interview_insights_test` never created) and fixed each.
4. Re-ran the smoke test clean, still with Docker Desktop not running —
   15/15.
5. Confirmed 80/443 parity again at this point specifically, since it's
   the exact claim #540 had left unverified with Docker Desktop actually
   absent rather than merely unused.
6. `brew uninstall --cask docker` — launchd services removed cleanly; two
   root-owned paths needed a second, interactive pass from the user.
7. Updated `wiki/deployment-guide.md`'s and `README.md`'s Prerequisites to
   lead with Podman, removing the "until #541 lands" language now that it
   had.

## What this enabled

Docker Desktop is no longer required *or* installed for anything in this
project. That closes out the whole arc this phase set out to run: D83
adopted Podman narrowly for Compose; D84 found `kind` didn't work on a
rootless machine; D88 found rootful fixed most of it but broke something
new; D89 found that "something new" was a test-config bug, not a platform
gap; D90/D91 did the real migration and found three more genuine issues
no earlier spike had reached; and this issue proved the result survives
with the thing it replaced completely gone, not just unused. Six issues,
seven decision records, each one gated on the previous one's actual
result rather than an assumption about what the next step would find —
which is exactly why three of them (D84, D88, D89) exist at all: each one
is the record of a step that *didn't* go as planned, kept instead of
skipped past.
