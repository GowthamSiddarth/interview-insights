# Phase 20, Issue #312 — Port-Forwards That Outlive the Shell That Started Them

*Part of Phase 20 — Operational Hardening & Live-Verification Findings.
Epic #214 reopened and re-closed the same day, same precedent as
#222/#240/#278. See `docs/ROADMAP.md` Phase 20.*

## The symptom looked like one flaky service, but wasn't

During Phase 28's live verification, Mailpit's port-forward kept
turning up dead. The natural first guess — something specific to
Mailpit — didn't survive contact with the evidence: Postgres and
OpenSearch's forwards died the exact same way, just as often. All
three shared one thing in common: each had been started with
`kubectl port-forward ... & disown` from inside this project's own
AI-assisted dev session.

## Key concept: `disown` protects against one thing, not everything

`disown` stops a background job from receiving `SIGHUP` when its
parent *shell* exits normally — that's genuinely useful, and it's why
this pattern usually works fine in an ordinary terminal. It does
nothing, though, if the process group the job belongs to gets torn
down some other way — and that's exactly what happens in a session
where tool calls can each execute in a fresh shell. This project's own
session logs even had direct evidence of it: a literal "Shell cwd was
reset" notice partway through a session, meaning the shell itself got
rebuilt. Whatever was backgrounded in the shell before that reset was
gone, `disown` or not — because `disown` was protecting against the
wrong failure mode.

## Key concept: the fix is to stop depending on the shell at all

The actual requirement is a process that outlives *any* shell,
including ones this project doesn't control the lifecycle of. On
macOS, that's exactly what `launchd` is for: a per-user LaunchAgent is
bootstrapped into the user's GUI session domain and supervised from
there, entirely independent of whichever terminal or script happened
to install it. `infra/scripts/dev-port-forwards.sh` generates one
LaunchAgent plist per forwarded service and bootstraps it:

```bash
launchctl bootout "gui/$(id -u)/$(label "$name")" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$(plist_path "$name")"
```

`KeepAlive` in the plist is a second win beyond persistence:
`kubectl port-forward` itself dies if the connection ever drops (a pod
restart, the API server hiccuping) and previously had to be noticed
and manually restarted — now launchd just relaunches it.

## Key concept: verify persistence by actually removing the assumption you're testing

The obvious "does this work" check — run `status` and see `running` —
proves the launchd job was accepted, not that it survives a shell
disappearing. The real test was `exec bash -c '...'`: replacing the
current shell process outright with a brand new one, then checking
whether the ports were still listening from inside it. They were —
confirming the actual property needed, not just that the command
exited zero.

## A portability wrinkle worth naming: macOS's `/bin/bash` is 3.2

The first draft of this script used `declare -A` for a service-name to
port-mapping table — clean, and completely broken on this machine.
Apple has shipped bash 3.2 as `/bin/bash` for well over a decade now
(a GPLv3 licensing decision, not an oversight), and 3.2 predates
associative arrays entirely. The fix was a `case` statement instead of
a map — slightly more verbose, genuinely portable, and consistent with
every other script already in `infra/scripts/`, none of which assume a
newer bash is installed.

## What this enabled

Local Postgres/OpenSearch/Mailpit access now survives exactly the
condition that used to break it — a shell disappearing mid-session —
with no change to how any other tooling reaches those services
(`localhost:5432`/`9200`/`1025`/`8025` are unchanged). `wiki/
deployment-guide.md`'s native dev-loop instructions, direct-access
instructions, and machine-migration checklist all point at the script
now instead of the plain `& `-backgrounded command that started this
investigation.
