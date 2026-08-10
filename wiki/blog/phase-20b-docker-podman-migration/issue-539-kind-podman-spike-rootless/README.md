# Phase 20b, Issue #539 — The `kind`-on-Podman Spike That Failed, and Why That's Not the End of the Story

*Part of Phase 20b — Docker → Podman Migration. See `docs/ROADMAP.md`
Phase 20b and `docs/DECISIONS.md` D84.*

## The question issue #496 deliberately left open

D83 (previous post) adopted Podman for `infra/docker-compose.yml` only —
`kind`, `ci.yml`, and `cd.yml` stayed Docker-backed, on purpose. That
scoping only works as a stepping stone if someone actually goes back and
answers the bigger question: can `kind` itself run against Podman at all?
Issue #539 is that spike, filed as the explicit prerequisite for #540
(migrate `cd.yml`/the self-hosted runner off Docker) and #541 (remove
Docker Desktop entirely) — neither of those can happen if `kind` can't
run without Docker underneath it.

The issue was written with its own decision gate built in: run four
verification tasks (node health, image loading, ingress port mappings,
api/web image parity); if any of the first two fail outright, stop, document
why, and don't chase the remaining two. That gate fired.

## Key concept: `KIND_EXPERIMENTAL_PROVIDER=podman` against the machine as it already existed

The test ran `KIND_EXPERIMENTAL_PROVIDER=podman kind create cluster`
against this machine's existing `podman-machine-default` — the same one
issue #496 had just verified for Compose. That machine was **rootless**
(`podman machine inspect` reports `rootful=false`), chosen implicitly
when it was created for D83's compose-only scope, not as a deliberate
decision for running `kind`. That detail turns out to be the whole story.

## Key concept: two failures, one likely shared root cause

**The control-plane node never reached `Ready`** — still `NotReady`
roughly 40 seconds after creation. `kind` runs an entire Kubernetes node
as a systemd-in-container process, and rootless Podman's cgroup
delegation is the tool's own most-cited failure mode for exactly this
symptom. This isn't a novel finding; it's the documented risk the issue
was written expecting to test for.

**`kind load docker-image` couldn't find an image Podman had just
built.** `podman build` succeeded and tagged the result
`localhost/spike-test:local` — but `kind load docker-image
spike-test:local` immediately errored `image: "spike-test:local" not
present locally`, even with the provider variable set correctly. The
likely cause: `kind load docker-image` shells out to `docker save` under
the hood, and Podman's `localhost/`-prefix naming convention for locally
built images doesn't match `docker`'s bare-name lookup. This was exactly
the risk the issue itself called out going in — confirmed real here, not
just theoretical — and the `podman save | kind load image-archive`
workaround it proposed to verify was never reached, since the node-health
failure above was already blocking.

**The API server itself went unstable** once the node was unhealthy —
`TLS handshake timeout` and `pod does not have a host assigned` on
subsequent `kubectl` calls in the same session. Read as a downstream
consequence of the node never finishing bring-up, not a separate,
independent bug.

## Key concept: a failed spike on one config isn't a verdict on the whole approach

The instinctive read of three failures in a row is "abandon `kind` on
Podman." The actual conclusion drawn here is narrower and more useful:
**rootless vs. rootful is the one machine-specific variable this spike
never varied.** `podman-machine-default` being rootless wasn't a
deliberate choice for this test — it was inherited from #496's compose-
only setup, where rootless vs. rootful was never a live question. Rootless
cgroup delegation is specifically what `kind`'s own documentation flags as
its riskiest mode; a rootful machine (`podman machine init --rootful`, or
`podman machine set --rootful` on the existing one) is a materially
different configuration, not a retry of the same failed test.

That distinction is what turns "verdict: doesn't work" into "verdict:
not proven either way yet, and here's the specific next experiment."
Re-testing against a rootful machine wasn't assumed to happen
automatically — it's called out explicitly as a real, separate follow-up,
not folded into this issue's own scope (which tested the machine as it
already existed, honestly, rather than reaching for a different
configuration mid-spike to make the result look better).

## Step-by-step: what actually got run

1. `podman machine inspect` to confirm the machine's actual mode
   (`rootful=false`) before testing, rather than assuming.
2. `KIND_EXPERIMENTAL_PROVIDER=podman kind create cluster` — observed the
   control-plane node stuck `NotReady`.
3. Waited past a reasonable bring-up window (~40s) before concluding it
   wasn't just slow.
4. `podman build` a synthetic test image, tagged `localhost/spike-test:local`
   automatically.
5. `kind load docker-image spike-test:local` — reproduced the "not present
   locally" error directly, confirming the naming-mismatch theory rather
   than guessing at it.
6. Ran a few more `kubectl` commands against the unhealthy cluster to
   characterize the API-server instability, then stopped — the issue's own
   decision gate said don't chase the remaining two verification tasks
   once the first two had failed.
7. Documented the rootless-vs-rootful gap as the specific, falsifiable next
   step rather than closing the door on Podman for `kind` entirely.

## What this enabled

`kind`, `ci.yml`, and `cd.yml` all stay Docker-backed — #540 and #541
both remain blocked, exactly as they were before this issue, just now for
a much more specific, testable reason than "unknown." The next post in
this phase (#545) is that re-test, against a rootful machine this time —
and it's a genuinely different result, not a repeat of this one.
