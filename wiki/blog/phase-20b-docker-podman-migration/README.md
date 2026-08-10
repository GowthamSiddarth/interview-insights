# Phase 20b — Docker → Podman Migration

See `docs/ROADMAP.md` Phase 20b. Split from Phase 20's original catch-all
epic (#214) on 2026-08-09. Milestone: "Phase 20b — Docker → Podman
Migration" (#41). Epic: GitHub issue #557.

A clean, self-contained project arc: replace Docker/Docker Desktop with
Podman across local dev, `kind`, and CD, one layer at a time with an
explicit decision gate at each step (D83-D93). Unlike Phase 20a/20c/20d/
20e, every issue in this arc got its own post — see the index below, or
`wiki/blog/README.md`'s Phase 20b section.

1. [Issue #496 — Podman for `infra/docker-compose.yml`, scoped deliberately narrow (D83)](issue-496-podman-compose-adoption/README.md)
2. [Issue #539 — The `kind`-on-Podman spike that failed, and why that's not the end of the story (D84)](issue-539-kind-podman-spike-rootless/README.md)
3. [Issue #545 — Rootful fixes two of three, then finds a new gap (D88)](issue-545-kind-podman-rootful-retest/README.md)
4. [Issue #547 — The "platform gap" that was actually a config bug (D89)](issue-547-extraportmappings-root-cause/README.md)
5. [Issue #540 — Migrating `cd.yml` to Podman, then finding three things no spike ever reached (D90, D91)](issue-540-cd-runner-podman-migration/README.md)
6. [Issue #541 — Proving it works absent, then actually removing it (D93)](issue-541-docker-desktop-removal/README.md)
