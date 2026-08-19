# Phase 45, Issue #655 — Real SMTP Relay, Replacing Mailpit

*Part of Phase 45 — App-Hosting Pilot on Hetzner. See `docs/ROADMAP.md`
Phase 45.*

## The gap this closed

Every other environment sends mail through Mailpit — a local SMTP
catcher (D29) that never actually delivers anywhere, by design, for
safe local testing. That's exactly wrong for a pilot meant to be
actually reachable: a real candidate submitting a review on
`app.interviewinsights.fyi` needs a real magic-link email, and Mailpit
would silently swallow it. This gap surfaced mid-work on #647 (the
secrets inventory) once the distinction became concrete enough to scope
out into its own issue.

## Provider choice: Brevo, not AWS SES

D101/D102 already drew an explicit boundary between this pilot and
D11's real AWS production target — standing up AWS SES here would blur
that boundary for a single pilot VM, the same reasoning that already
ruled out real Secrets Manager for #647. Brevo's free tier (300
emails/day, no credit card) fits the same "cheap, non-AWS, no vendor
lock-in" shape this project already established for the pilot as a
whole.

## The domain-independent half, done ahead of the domain

`MAIL_FROM_ADDRESS` (`noreply@interviewinsights.fyi`) obviously
couldn't be finalized before the domain itself existed (#658) — but the
actual SMTP *auth* support didn't need to wait. `api`'s and
`notification-service`'s mail transporters (duplicated per D73, same
reasoning as everywhere else in this project that keeps the two
services' mail-sending logic independent rather than sharing a
package) gained optional `MAIL_SMTP_USER`/`MAIL_SMTP_PASSWORD` support:

```ts
export const mailTransporterProvider: Provider = {
  provide: MAIL_TRANSPORTER,
  useFactory: () =>
    nodemailer.createTransport({
      host: process.env.MAIL_SMTP_HOST ?? 'localhost',
      port: Number(process.env.MAIL_SMTP_PORT ?? 1025),
      secure: false,
      auth: process.env.MAIL_SMTP_USER
        ? { user: process.env.MAIL_SMTP_USER, pass: process.env.MAIL_SMTP_PASSWORD }
        : undefined,
    }),
};
```

`secure: false` stays correct for both targets, which isn't obvious at
a glance: Mailpit has no TLS at all, and Brevo's port 587 negotiates
STARTTLS *opportunistically* under `secure: false` — nodemailer only
forces implicit TLS when `secure` is `true`, which is port 465's job,
not 587's. `MAIL_SMTP_USER` unset (every environment but the pilot)
means no `auth` block at all — unchanged behavior everywhere else,
verified via both services' existing unit test suites passing
unmodified.

## `MAIL_SMTP_USER` is not a secret

Brevo's login is just an email address — the same non-secret status
this project already gives `POSTGRES_USER` (`01-postgres-config.yaml`'s
own comment makes the same distinction). It lives in
`overlays/hetzner-pilot/api-config-patch.yaml`'s plain ConfigMap, not a
Secret; only `MAIL_SMTP_PASSWORD` (the actual Brevo SMTP key) went
through Pattern B/D105's secret-provisioning path.

## Verification

Unit tests for both services' mail transporters passed unmodified
(`api`: 13/13). The real, end-to-end proof came later, folded into
#648's own deploy verification once the domain and overlay wiring
(#646) both existed — this issue's own scope stopped at "the code path
supports auth," by design, since the domain-dependent half genuinely
couldn't be tested before #658 landed.
