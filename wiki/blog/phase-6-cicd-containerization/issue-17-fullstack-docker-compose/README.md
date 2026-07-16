# Phase 6 Hardening, Issue #17 — Full-Stack Docker Compose

*Part of Phase 6 — CI/CD & containerization. See `docs/ROADMAP.md` Phase 6.*

This post goes deeper than earlier ones, by request — Docker multi-stage
builds and Compose profiles are broadly reusable concepts well beyond
this project, and the two real bugs found here are exactly the kind that
silently work in development and only surface once someone tries to run
the *actual* production artifact.

## Why this came first

Every phase up to this point ran `api` and `web` directly on the host via
`npm run dev`/`npm run start:dev` — fast for iteration, but it never once
proved that the actual Docker images this project would eventually deploy
(to Kubernetes, to any real environment) actually work. Issue #17 is
where those images get built and run for the first time, and — as is
often the case the first time a "should work in theory" artifact is
actually exercised — two real, latent bugs in the Dockerfiles surfaced
immediately.

## Core concept: multi-stage Docker builds, and why they exist

A Docker image built naively (one `FROM`, install dependencies, copy
source, done) ends up containing everything used to *build* the app —
dev dependencies, build tools, source maps, the entire `node_modules`
tree including packages only needed for compiling TypeScript — none of
which the running application needs, all of which make the final image
larger and its attack surface bigger. **Multi-stage builds** solve this
by using multiple `FROM` statements in one Dockerfile, each starting a
new, independent build stage that can selectively copy specific files
*out of* an earlier stage via `COPY --from=<stage>`, discarding
everything else that stage produced.

This project's `api/Dockerfile` uses three stages:

```dockerfile
FROM node:22-slim AS base
# shared setup (openssl, for Prisma's engine binary)

FROM base AS build
# npm ci (full dev+prod deps), prisma generate, npm run build
# -> produces dist/, node_modules/, prisma/

FROM base AS runtime
# selectively copies ONLY what's needed to run, nothing used to build it
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
```

The `runtime` stage never runs `npm ci` itself — it just copies the
`build` stage's already-installed `node_modules` wholesale. This
distinction (copy vs. reinstall) is exactly where this issue's first real
bug lived.

## Bug #1: the runtime stage silently depended on network access it
shouldn't have needed

The Dockerfile's runtime stage *originally* ran `npm ci --omit=dev` (to
strip dev dependencies for a smaller image) and then still called `npx
prisma generate`/`migrate deploy`. But `prisma` — the CLI needed to run
migrations — is itself a **devDependency**, correctly, since it's a
build/ops tool, not something the running application imports at
runtime. `npm ci --omit=dev` correctly removed it. `npx prisma migrate
deploy` then silently worked anyway in casual testing — because `npx`,
when it can't find a package locally, falls back to fetching it from the
npm registry over the network on the spot. This is precisely the kind of
bug that hides in development (a machine with internet access, testing
casually, never notices the fallback happening) and surfaces as a hard
failure in a genuinely isolated environment (a CI runner or a production
node with restricted egress, where that silent network fallback simply
fails).

**The fix, and the general lesson**: don't reinstall a slimmed-down
dependency tree in the runtime stage at all — copy the *build* stage's
full `node_modules` (which already has `prisma` installed, from the
initial `npm ci`) wholesale instead. This is Prisma's own documented
Docker pattern, and the general principle behind it generalizes well
past Prisma specifically: **any tool your runtime container needs to
invoke at startup must be verifiably present in that stage without
relying on any implicit network fallback** — if a command "just works"
in development, always ask whether it's succeeding because the artifact
is correct, or because something in your dev environment (network
access, a global install, a cached registry) is quietly papering over a
missing dependency.

## Bug #2: a missing directory the build assumed would exist

`web/Dockerfile`'s runtime stage tried to `COPY --from=build /app/public
./public` — but this project's Next.js app had no `public/` directory at
all (nothing had ever needed one; there were no static assets to serve).
`COPY` from a nonexistent source path fails the build outright. The fix
was almost comically simple — add `web/public/.gitkeep` so the directory
exists (even empty) — but the *reason* it took until this issue to
surface is the interesting part: `npm run dev`/`npm run build` on the
host never complained about a missing `public/`, because Next.js treats
it as entirely optional at the framework level. Only a Dockerfile that
explicitly assumes the directory's existence (to `COPY` it) actually
requires it to be there. **The general lesson: a framework being lenient
about an optional convention doesn't mean every tool downstream of it
shares that leniency** — a build script, a Dockerfile, a deployment
manifest can all have stricter assumptions than the framework itself
does, and those assumptions only get checked once something actually
exercises that specific path.

## Core concept: Docker Compose profiles

`infra/docker-compose.yml` needed to serve two different purposes without
regressing either: the fast, Postgres/OpenSearch-only local dev loop
every previous phase relied on, and a full, containerized stack for
testing the real images this issue builds. **Compose profiles** are the
built-in mechanism for exactly this: a service tagged `profiles: ["full"]`
is skipped by a plain `docker compose up`, and only started when that
profile is explicitly requested (`docker compose --profile full up
--build`). This is a broadly reusable pattern for any Compose file that
needs to serve both "just the dependencies, run the app natively" and
"the complete containerized stack" without maintaining two separate
Compose files that could drift out of sync with each other.

```yaml
services:
  postgres: { ... }      # always starts — default profile
  opensearch: { ... }    # always starts — default profile
  api:
    profiles: ["full"]   # only starts with --profile full
    build: { context: ../api, dockerfile: Dockerfile }
    depends_on:
      postgres: { condition: service_healthy }
      opensearch: { condition: service_healthy }
  web:
    profiles: ["full"]
    build: { context: ../web, dockerfile: Dockerfile }
    depends_on: [api]
```

`depends_on`'s `condition: service_healthy` (rather than just declaring
an ordering) is what actually makes this reliable — `api` won't start
until Postgres's and OpenSearch's own healthchecks (from Phase 1.3 and
Phase 5's issue #21) report healthy, not merely "the container process
started," which for a database can be well before it's actually ready to
accept connections.

## Step-by-step: what actually got built

1. **Diagnosed and fixed the `prisma` CLI gap** in `api/Dockerfile` —
   switched the runtime stage from `npm ci --omit=dev` + regenerate, to
   copying the build stage's `node_modules` wholesale.
2. **Diagnosed and fixed the missing `public/` directory** in
   `web/Dockerfile` — added `web/public/.gitkeep`.
3. **Set `api`'s container `CMD`** to run `npx prisma migrate deploy`
   automatically before starting the server — meaning a freshly-started
   container against an empty database self-migrates, rather than
   requiring a manual step.
4. **Added `api`/`web` back into `infra/docker-compose.yml`**, behind a
   `full` Compose profile, leaving the default `docker compose up`
   behavior (Postgres + OpenSearch only) completely unchanged.
5. **Verified three separate, genuinely different things**, each proving
   a different claim rather than assuming one check covers all of them:
   - Built and ran the full profile against the *existing* dev Postgres,
     confirmed `/health` and a full browser flow through the
     containerized `web` talking to the containerized `api` with zero
     console errors — proves the images work functionally.
   - Ran the `api` image against a genuinely fresh, empty Postgres in an
     isolated container, to prove all migrations apply correctly from a
     truly clean state — not just a no-op against an already-migrated
     database, which the first check alone couldn't have ruled out.
   - Confirmed `npm run build`/`lint`/`test` still pass natively in both
     `api` and `web` — proving the Dockerfile changes didn't regress the
     host-based fast dev loop every previous phase depended on.

## What this enabled

The exact images built and fixed here are what Phase 7's Kubernetes work
(issues #27/#28) later loads directly into a `kind` cluster via `kind
load docker-image` — the `NEXT_PUBLIC_API_URL` build-arg pattern issue
#28 needed was a direct, unmodified reuse of this issue's `web/Dockerfile`
structure, just with a different `--build-arg` value for a different
target host. Neither Dockerfile bug fixed here needed to be revisited in
any later phase — both were genuinely fixed at the root cause, not
patched around.
