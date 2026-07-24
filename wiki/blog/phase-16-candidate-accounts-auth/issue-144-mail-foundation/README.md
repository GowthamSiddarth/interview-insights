# Phase 16, Issue #144 — Mail Foundation

*Part of Phase 16 — Candidate Accounts & Auth. See `docs/ROADMAP.md`
Phase 16.*

## Why this phase, and why mail first

Phase 16 exists to close a gap that had been sitting quietly since
Phase 3: `docs/DECISIONS.md` D14 documented that candidate email
verification issued a token but never actually emailed it — the token
was just returned directly in the API response, "a deliberate temporary
gap." That gap only got more uncomfortable as the platform grew real
write paths, a moderation admin surface, and a public analytics
dashboard. Magic-link login was the chosen replacement for that whole
flow (see issue #145), and a magic link is worthless if nothing ever
delivers it — so before any auth logic could be written, something had
to actually be able to send an email.

## Key concept: Mailpit over LocalStack SES

The kickoff brainstorm for this phase deliberately looked at two paths
before writing code, per this project's "plan a phase before
implementing" convention. LocalStack SES was the obvious "reuse what
Phase 10/11 already built" option — but it would have dragged in a full
AWS-shaped email-sending emulation (SES identity verification, sandbox
mode, IAM policy for `ses:SendEmail`) for a feature that has no near-term
real-sending plan. Mailpit is a stateless SMTP catcher with a REST API
and web UI — the entire footprint needed for "verify that an email was
sent, and read what it said," at a fraction of the operational surface.
Documented as D29. Nothing about this decision revisits D19/D20's
LocalStack choice for secrets/IAM — it's scoped narrowly to "how does
this project send email in local dev," a genuinely separate concern.

## Key concept: a real dependency, not a mocked one

`infra/k8s/base/08-mailpit.yaml` adds Mailpit as a stateless Deployment
with no PVC — losing the dev mailbox on a pod restart is an acceptable
trade for a tool that only ever holds transient verification emails —
alongside an unconditional `infra/docker-compose.yml` service, giving it
the same standing as Postgres/OpenSearch rather than treating it as an
optional add-on. Mailpit's REST API shape (`GET /api/v1/messages`,
`/search?query=`, `/message/{id}`) and the absence of a documented
HTTP health-check endpoint were confirmed by running the real
`axllent/mailpit` image locally and inspecting it directly — not
assumed from its docs site, which didn't have the exact shapes
crawlable. That's why the k8s manifest uses a `tcpSocket` probe and CI's
service container uses the image's own busybox `wget --spider`, instead
of guessing an HTTP path that might not exist.

## System design approach

```
api/src/mail/
  mail.service.ts               # send({ to, subject, text, html? })
  mail-transporter.provider.ts  # DI-injected nodemailer SMTP transport
  mail.module.ts                # no controller yet, no consumer wired in
```

`MailService` is configured entirely from env vars
(`MAIL_SMTP_HOST`/`MAIL_SMTP_PORT`/`MAIL_FROM_ADDRESS`) via a
provider-token pattern already established for `OPENSEARCH_CLIENT` —
consistent DI shape across every external-service integration in the
codebase, rather than a new pattern per module. Deliberately no
controller and nothing wired into `AppModule` yet: this issue's whole
job is "email can be sent," not "something sends one" — that's magic-link
auth's job, one issue later.

## Step-by-step: what actually got built and verified

1. **The `mail/` module**, unit-tested against a mocked transporter (4
   tests) — no network, no real SMTP server needed for these.
2. **A real `mail.e2e-spec.ts`** proving a message sent through
   `MailService` actually lands in a real Mailpit inbox — the one test
   in this issue that needs the real dependency running.
3. **CI wiring**: `.github/workflows/ci.yml`'s `api` job gained a
   `mailpit` service container so the e2e test above runs on every PR,
   not just locally.
4. **Live verification before the PR even merged**: applied
   `08-mailpit.yaml` directly against the running `kind` cluster,
   port-forwarded to it, and confirmed the same send-and-receive loop
   worked in-cluster, not just against a local Docker container.

## What this enabled — and one gap it almost left behind

With mail delivery real, issue #145 could build magic-link auth against
an actual inbox instead of a stub. One gap surfaced immediately during
live verification and was fixed the same day, without its own issue:
`infra/k8s/base/05-api.yaml`'s `api-config` ConfigMap never got
`MAIL_SMTP_HOST`/`MAIL_SMTP_PORT` pointing at Mailpit's in-cluster
Service DNS, the same pattern `OPENSEARCH_URL` already used. Harmless at
the time — nothing consumed those env vars yet — but it would have
silently fallen back to `MailService`'s `localhost` default the moment
issue #145 gave it a consumer, and nobody would have noticed until a
magic-link email quietly failed to send in a deployed environment.
Fixed immediately rather than left for #145 to rediscover the hard way.
