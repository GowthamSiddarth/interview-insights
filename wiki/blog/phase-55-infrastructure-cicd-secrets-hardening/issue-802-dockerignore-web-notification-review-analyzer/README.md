# Phase 55, Issue #802 — Missing .dockerignore on Three of Four Dockerfiles

*Part of Phase 55 — Infrastructure, CI/CD & Secrets Hardening.
See `docs/ROADMAP.md` Phase 55.*

## The gap

`api/.dockerignore` has existed since issue #450, closing a real gap
where a local `.env` file in the build context could get copied
wholesale into an image layer by an unqualified `COPY . .` — anyone
who later pulls that image can extract secrets straight out of its
layers, long after the running container itself looks fine. `web/`,
`notification-service/`, and `review-analyzer/` never got the same
treatment — the exact same class of bug, just not yet found in the
three siblings nobody had gone back and checked.

## The fix: the same file, three more times

```
# web/.dockerignore, notification-service/.dockerignore,
# review-analyzer/.dockerignore — mirroring api/.dockerignore
node_modules
.env
.env.local
dist
.git
```

Nothing clever here — the fix is recognizing the pattern needed
applying uniformly across every service with its own Dockerfile, not
just the one it happened to be written for originally. A useful
reminder that a security fix scoped to "the service I'm looking at
right now" can leave identical siblings exposed indefinitely unless
something later goes looking specifically for the pattern to repeat.

## Verification

Built each of the three images locally and confirmed the resulting
image has no `.env`/`.env.local` layer — `docker history`/`podman
history` on each shows no local secret file ever entered the build
context. No automated test for this (an image-content assertion isn't
something this project's test suites currently check), so this stays a
manual, one-time verification per image rather than a regression-tested
guarantee — worth flagging as a real gap if a `.dockerignore` file were
ever accidentally reverted.
