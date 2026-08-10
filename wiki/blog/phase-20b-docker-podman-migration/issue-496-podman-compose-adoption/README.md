# Phase 20b, Issue #496 — Podman for `infra/docker-compose.yml`, Scoped Deliberately Narrow

*Part of Phase 20b — Docker → Podman Migration. See `docs/ROADMAP.md`
Phase 20b and `docs/DECISIONS.md` D83.*

## Why this started narrow, on purpose

This issue asked one specific question: can `infra/docker-compose.yml`
run on Podman instead of Docker Desktop? Not "can `kind` run on Podman,"
not "can CI/CD run on Podman" — just the reference compose file and its
docs. That scoping mattered more than it looked like at the time. D24/D26/
D29 had already established that `infra/docker-compose.yml`'s postgres/
opensearch/mailpit services are "documented reference only" — the actual
everyday local-dev loop runs against `kind` via `kubectl port-forward`
(`infra/scripts/dev-port-forwards.sh`), which this issue explicitly left
alone. So whatever this decided, it couldn't accidentally break the loop
anyone was actually using day to day.

No incident forced this one, either — unlike D35/D43's Docker-Desktop-
disk-fill emergencies on the CD runner, #496 was filed as a speculative
"is this worth it" evaluation. That framing shaped how it got tested: hands
on, verifying the specific things that could quietly break, not just "does
`podman compose up` exit zero."

## Key concept: `podman compose` is a dispatcher, not a reimplementation

The single biggest risk the issue flagged going in was whether Podman's
Compose support actually honors `depends_on: condition: service_healthy`
— `api`'s container needs to wait for postgres *and* opensearch to report
healthy, not just "started," before booting. The separate `podman-compose`
Python tool has a documented history of not honoring that condition
correctly.

The reason that risk was real: since Podman v4, `podman compose` isn't its
own Compose engine at all. It's a thin dispatcher that shells out to
whatever Compose-spec-compatible binary it finds on `PATH`. On the machine
this was verified against, that happened to be Docker Desktop's own
`docker compose` v2 plugin (`~/.docker/cli-plugins/docker-compose`) —
genuinely the real Compose v2 codebase, just pointed at Podman's API
socket instead of `dockerd`'s. Verified directly in compose's own event
log, not just inferred from a successful `api` boot: `api` demonstrably
waited for both dependencies to report `Healthy` before starting.

That also means the *quality* of this verification was borrowed from
Docker Desktop's plugin, which creates a real follow-up: **if Docker
Desktop is ever uninstalled, that dispatch target disappears with it.**
`podman compose` would fall back to `podman-compose` — the exact tool
whose `condition: service_healthy` gap motivated testing this in the first
place — or fail outright if neither is on `PATH`. The decision this issue
landed on explicitly flags this as unresolved: before removing Docker
Desktop, install a standalone Compose v2 binary
(`brew install docker-compose`, no cask required) so `podman compose`
keeps dispatching to a real Compose v2 client. That flag turned out to
matter later — issue #541, three posts on in this same phase, is exactly
"remove Docker Desktop," and had to carry this caveat forward.

## Key concept: two rollout gotchas that looked like real bugs but weren't

Both of these produced misleading errors that pointed at the wrong
subsystem entirely:

1. **A stale Docker Hub credential, cached in the wrong place.** Docker
   Desktop's `credsStore: desktop` Keychain helper
   (`~/.docker/config.json`) held an invalid cached credential, producing
   `unauthorized: incorrect username or password` on what should have
   been a clean anonymous pull. The instinctive fix — `podman logout` —
   does nothing, because Podman's own auth file
   (`~/.config/containers/auth.json`) is a completely separate credential
   store from the one actually causing the failure. `docker logout
   docker.io` is what actually cleared it, even though `podman compose`
   was the thing failing.
2. **Docker Hub's anonymous pull-rate-limit**, hit repeatedly during setup.
   Worked around with a `mirror.gcr.io` pull-through mirror for the
   `docker.io` prefix in the podman machine VM's own
   `/etc/containers/registries.conf`. Notably, this mirror does **not**
   cover `docker.redpanda.com` — a differently-named registry host that
   turned out to proxy through the same Docker Hub backing store and hit
   the same limit. Not a blocker for this issue specifically (redpanda
   isn't in api/web's `depends_on`, so it never affected the
   `service_healthy` verification), but a gap worth knowing about before
   assuming the mirror fixes every pull.

## What actually got verified, step by step

1. `podman machine init`/`start` (rootless, chosen implicitly since D83's
   compose-only scope never forced a rootful-vs-rootless decision — that
   choice would come back to matter a lot in the very next issue, #539).
2. `podman compose up` against the default profile
   (postgres/opensearch/mailpit/redpanda) — confirmed `api`'s container
   genuinely blocked on `service_healthy`, not just `service_started`.
3. `podman compose --profile full up` — both `api/Dockerfile` and
   `web/Dockerfile` build cleanly under Podman's build engine unmodified:
   `apt-get`, `npm ci`, `prisma generate`, `nest build`, `next build` all
   succeeded exactly as they do under Docker.
4. Confirmed postgres/opensearch/mailpit and api/web all independently
   reachable on their published ports once the stack was up.
5. Diagnosed and worked around both gotchas above, live, before writing
   anything down as a documented fix.

## What this enabled

`infra/docker-compose.yml`'s reference path — the default profile and
`--profile full` — is Podman-adopted, with `kind`/`ci.yml`/`cd.yml`
explicitly untouched, exactly as scoped. It also produced the first real
signal for the rest of this phase: Podman's Compose support works, but
only by leaning on Docker Desktop's own plugin underneath it, and the
machine this was verified against is rootless. Both of those threads get
pulled on immediately in the next post — issue #539 asks the much bigger
question this one deliberately deferred: can `kind` itself run on Podman?
