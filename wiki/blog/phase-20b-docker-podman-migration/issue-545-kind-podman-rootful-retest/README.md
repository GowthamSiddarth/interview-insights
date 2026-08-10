# Phase 20b, Issue #545 — Rootful Fixes Two of Three, Then Finds a New Gap

*Part of Phase 20b — Docker → Podman Migration. See `docs/ROADMAP.md`
Phase 20b and `docs/DECISIONS.md` D88.*

## Running the experiment the last post called for

D84 (issue #539, previous post) ended with a specific, falsifiable next
step: re-run the same spike against a **rootful** `podman machine`,
since rootless-vs-rootful was the one variable that spike never actually
tested. Issue #545 is exactly that — same `podman-machine-default`
machine, switched with `podman machine set --rootful=true`, then re-run
both of #539's failed checks plus the two it never got far enough to
reach.

## Key concept: rootful genuinely fixes what rootless broke

The control-plane node reaches `Ready` in about 15 seconds under rootful
— it was permanently stuck `NotReady` under rootless. This isn't a
marginal improvement; it directly confirms D84's own theory about
rootless cgroup delegation being the culprit, on the exact variable D84
called out as the untested one. Worth stating plainly: this is what a
spike's "revisit when" section is supposed to produce — a specific,
correctly-targeted next experiment that actually resolves the open
question, rather than a vague "try again later."

## Key concept: a workaround that D84 flagged but never reached, now verified

`kind load docker-image` is still broken under rootful — both the bare
image name and the `localhost/`-prefixed name get rejected as "not
present locally," the identical symptom D84 saw. That confirms this
particular failure is inherent to how `kind load docker-image` shells out
to `docker save`-shaped assumptions against Podman's different image
naming — not a rootless-specific symptom, so switching to rootful alone
doesn't fix it.

But the workaround D84 proposed and never got to test — because the
node-health failure blocked everything before it — **works cleanly here**:

```bash
podman save <image> | kind load image-archive /dev/stdin
```

Piping the image archive directly, rather than asking `kind` to resolve
the image by name, sidesteps the naming mismatch entirely. This is the
first real evidence that the whole `kind`-on-Podman approach might be
viable, not just "the node boots now."

## Key concept: fixing two blockers reveals a third one nothing had reached yet

With node health and image loading both resolved, this issue could
finally test `extraPortMappings` — what ingress-nginx's
`controller.hostPort.enabled=true` relies on for host ports 80/443, and
therefore what both #540 (the CD runner's own smoke test hits
`app.interview-insights.local:80`) and #541 (local dev's ingress-based
access) actually depend on.

The result was a real, new gap. A test pod with `hostPort: 8080`,
matching a `kind`-config `extraPortMappings` entry, reached `Ready`
cleanly — `pod/spike-545-hostport condition met`, no probe or readiness
problem at all. But the mapped host port was unreachable from the Mac
host: `curl` against `localhost:18080` simply failed. Not a slow-to-start
issue, a real port-plumbing gap somewhere between the kind node container
and the Mac host.

The root cause wasn't isolated in this pass — the working theory at the
time was that `kind`'s podman provider (explicitly experimental; `kind
create cluster` itself prints "enabling experimental podman provider" as
a banner) wasn't correctly publishing the node container's ports through
the podman machine VM the way Docker Desktop's `vpnkit` does
transparently. That theory turned out to be wrong, but disproving it
took a dedicated follow-up issue — the same "stop at the first
unresolved blocker rather than push through everything in one pass"
discipline #539 already established.

## Step-by-step: what actually got run

1. `podman machine set --rootful=true` on the existing machine (no fresh
   `init` needed).
2. Re-ran `kind create cluster` — confirmed `Ready` in ~15s, a clean,
   direct contrast against #539's permanent `NotReady`.
3. Re-ran the image-load check with both a bare name and a
   `localhost/`-prefixed name — both still failed, confirming this
   symptom is naming-mechanism-inherent, not rootless-specific.
4. Tested the `podman save | kind load image-archive` workaround D84
   proposed but never reached — worked on the first try.
5. Built a synthetic test pod with `hostPort: 8080` matching a
   `extraPortMappings` entry in the kind config, confirmed it reached
   `Ready`, then tried reaching it from the Mac host and got nothing.
6. Documented the finding and stopped — didn't attempt to diagnose the
   root cause in the same pass, filed it as its own follow-up instead.

## What this enabled

Two of the three original blockers from #539 are now closed for good:
node health and image loading both have confirmed fixes. `kind`, `ci.yml`,
and `cd.yml` still stay Docker-backed for now, but the reason has gotten
much narrower — it's specifically host-port publishing under kind's
podman provider, not a general "does this even work" question anymore.
The next post in this phase (#547) is the dedicated diagnosis of exactly
that gap — and finds something genuinely surprising about where the bug
actually was.
