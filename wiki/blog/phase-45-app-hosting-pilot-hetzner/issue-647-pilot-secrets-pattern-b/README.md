# Phase 45, Issue #647 — Secrets for the Pilot Environment

*Part of Phase 45 — App-Hosting Pilot on Hetzner. See `docs/ROADMAP.md`
Phase 45 and `docs/DECISIONS.md` D102.*

## The gap this closed

Every other environment this project runs (`dev`/`staging`/`prod`, all
local `kind` clusters) fetches its real secrets — `DATABASE_URL`,
`EMAIL_HASH_SECRET`, `EMAIL_ENCRYPTION_KEY`, `CANDIDATE_JWT_SECRET`,
`ADMIN_PASSWORD_HASH`, `ADMIN_JWT_SECRET` — from LocalStack Secrets
Manager at boot (Phase 11, `SECRETS_SOURCE=localstack`). LocalStack
itself is dev-only by design (D20/D22/D23): an emulator for exercising
the Secrets Manager/IAM code path locally, not a real secrets backend
for a pilot meant to actually be reachable. Before `overlays/hetzner-pilot`
could exist at all (#646), this project needed a real answer for where
these values live instead.

## Three options, one rejected pattern already established

- **LocalStack anyway** — rejected outright; that's exactly what it's
  not designed for.
- **Real AWS Secrets Manager** — considered and rejected. D101 already
  draws an explicit boundary between this pilot and D11's real AWS
  production target (Phase 8). Standing up a real Secrets Manager
  account/IAM footprint just to serve one pilot VM would blur that
  boundary for no real benefit at this scale.
- **A hosted secrets service** (Infisical/Doppler free tier) —
  considered and rejected too: a new external vendor relationship and
  its own account/token management, for a single-VM pilot that doesn't
  need rotation history or a UI.

**Decision (D102):** every pilot secret becomes Pattern B — provisioned
imperatively, the same shape this project already uses for
`postgres-credentials`/`admin-credentials`/`anthropic-credentials`/
`localstack-credentials` everywhere else, just extended to cover the
secrets that are Pattern A (LocalStack) in every other environment.

## Why this needed zero application-code changes

`bootstrapSecretsFromLocalStack()` in each service's
`localstack-secrets-bootstrap.ts` is already a no-op unless
`SECRETS_SOURCE=localstack` is explicitly set (Phase 11, issue #79) —
every environment that doesn't set it (docker-compose, and now this
pilot) already falls back to reading these values as plain environment
variables. `overlays/hetzner-pilot`'s ConfigMap patch simply never sets
`SECRETS_SOURCE`, so the fallback path already exercised daily by
docker-compose is what serves the pilot too. The only real work left —
deliberately scoped to later issues, not this one — was wiring
`envFrom.secretRef` entries into each Deployment (#646) and actually
provisioning the Secrets on the live VM (#648, later superseded by
`cd-hetzner.yml`/#708 doing this automatically on every deploy).

## What changed later (worth naming so this post ages honestly)

This issue's own decision held, but its *sourcing* mechanism didn't:
D102 assumed manual, out-of-band provisioning (`kubectl create secret`
run by hand from a password manager), specifically because no CD
workflow reached this environment yet. Once #708 built
`cd-hetzner.yml` — a real CD workflow that does reach the pilot — D105
superseded D102's manual-sourcing half: every secret this issue scoped
is now provisioned by that workflow itself, from GitHub Actions repo
secrets (`HETZNER_*`), on every deploy. The *pattern* (imperative,
never committed, Pattern B) is unchanged; only *who runs the
provisioning command* moved from a human to CI.

## Verification

Docs-only issue — no code path to smoke-test directly. Its real
acceptance criteria were downstream: #646 wiring `envFrom.secretRef`
into the overlay per this inventory, and #648 (later, via #708)
provisioning the actual Secrets and confirming every pod reaches
`Ready` off them. Both happened; see those posts.
