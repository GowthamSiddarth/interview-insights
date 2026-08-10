# Phase 20b, Issue #547 — The "Platform Gap" That Was Actually a Config Bug

*Part of Phase 20b — Docker → Podman Migration. See `docs/ROADMAP.md`
Phase 20b and `docs/DECISIONS.md` D89.*

## What this issue existed to isolate

D88 (issue #545, previous post) left one specific, narrow question open:
was `extraPortMappings` failing because kind's podman provider — explicitly
experimental — genuinely doesn't publish host ports correctly, or was
something else going on? That distinction mattered a lot: one answer means
`kind` on Podman is fundamentally blocked on host-port-dependent workloads
(which includes ingress-nginx, which both #540 and #541 depend on); the
other means there's a fixable bug somewhere specific. Issue #547 was filed
to isolate exactly which one, on the same machine as #545 — rootful
`podman-machine-default`, unchanged Podman 6.0.2 / kind v0.32.0.

## Key concept: isolate the mechanism by testing each layer independently, not the whole stack at once

Rather than re-running the same failing pod config and staring at it
harder, this issue broke the question into three separate, independently
falsifiable tests:

1. **Does the podman machine VM itself publish ports correctly, with
   `kind` removed from the picture entirely?** A plain
   `podman run -p 18081:80`, nothing to do with `kind` at all, worked
   cleanly — `curl` returned `HTTP 200`. This rules out a blanket
   Podman-machine/`gvproxy` gap as the cause; whatever's broken, it isn't
   VM-level port forwarding in general.
2. **Does kind's podman provider actually publish `extraPortMappings`,
   mechanically?** `podman inspect` on the node container showed the
   declared mapping (`8080/tcp -> 0.0.0.0:18080`) present and correct.
   kind's provider isn't silently dropping the publish step — the mapping
   genuinely exists at the container level.
3. **Given both of those check out, what's actually different about the
   failing pod?**

That third question is where the real finding was.

## Key concept: reproducing a bug on purpose is more informative than reproducing it by accident

Rather than assuming D88's original test config was correct and hunting
for a platform-level explanation, this issue tried something more direct:
deliberately misconfigure a pod the same way D88's writeup described, and
see if it produces the identical symptom. A pod declaring `hostPort: 8080`
paired with `nginx:alpine` — an image that actually listens on port
**80**, not 8080 — reproduced D88's exact "`Ready` but unreachable from
the host" symptom precisely.

That's a strong signal, not a coincidence: it means D88's original spike
very likely made the identical mistake — declaring a `hostPort`/
`containerPort` pair without verifying it matched the container image's
real listening port — and attributed the resulting connection failure to
a platform-level gap rather than a test-configuration bug. The pod
reaching `Ready` never told the whole story; a probe passing and a port
actually being reachable are two different claims, and only one of them
was ever tested.

## Key concept: confirm the fix works end-to-end, not just "no longer errors"

Recreating the pod correctly — `containerPort: 80` (matching
`nginx:alpine`'s real listener) and `hostPort: 8080` (matching the
node-level `extraPortMappings` entry) — returned `HTTP 200` from two
different vantage points:

- **From inside the node container**, isolating the node→pod `hostPort`
  DNAT specifically.
- **From the Mac host**, exercising the full host→VM→node→pod path end to
  end.

Both were confirmed twice, including after a fresh pod delete/recreate,
specifically to rule out a fluke rather than trusting a single successful
run.

## Caveat this issue was explicit about, not glossed over

This validated the `extraPortMappings` + `hostPort`-DNAT *mechanism* — the
same mechanism ingress-nginx's `controller.hostPort.enabled=true` relies
on — but it deliberately did not run the real `infra/scripts/
bootstrap-kind.sh` + ingress-nginx Helm flow on the actual production
ports (80/443). Those ports were still bound by the existing Docker-backed
`interview-insights` kind cluster on this machine at the time, and
stopping that cluster felt out of scope for what was meant to be a
narrow diagnostic issue. So the conclusion here is "the mechanism kind's
podman provider relies on genuinely works," not yet "ingress-nginx on
80/443 is confirmed working in production." That gap between mechanism
and production parity is exactly what the next post in this phase (#540)
closes.

## Step-by-step: what actually got tested

1. `podman run -p 18081:80` standalone, no `kind` involved — confirmed
   `HTTP 200`, ruling out a VM-level forwarding gap.
2. `podman inspect` on the running kind node container — confirmed
   `extraPortMappings`' declared mapping was actually present.
3. Deliberately recreated D88's likely mistake: `hostPort: 8080` against
   `nginx:alpine` (real listener: 80) — reproduced the exact "Ready but
   unreachable" symptom on demand.
4. Corrected the config to `containerPort: 80` / `hostPort: 8080` —
   confirmed `HTTP 200` from inside the node container first (isolating
   node→pod), then from the Mac host (full path).
5. Deleted and recreated the pod, re-tested both vantage points again —
   confirmed the fix wasn't a one-off fluke.
6. Documented the mechanism-vs-production-parity caveat explicitly rather
   than overclaiming the result.

## What this enabled

`#540` and `#541` — migrating `cd.yml`/the self-hosted runner off Docker,
and removing Docker Desktop entirely — are now unblocked. The blocker
that stopped both of them in #539 and narrowed in #545 turned out not to
be a platform limitation at all, just an unverified assumption in a test
config. The next post in this phase is where that unblock gets spent: the
real migration, run against the real 9-pod stack, on the real ports.
