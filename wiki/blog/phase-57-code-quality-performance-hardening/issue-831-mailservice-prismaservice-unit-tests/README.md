# Phase 57, Issue #831 — MailService and PrismaService Have No Dedicated Unit Tests

*Part of Phase 57 — Code Quality & Performance Hardening.
See `docs/ROADMAP.md` Phase 57.*

## The gap

`notification-service`'s `MailService`/`mail-transporter.provider.ts`,
and `PrismaService` in all three services, had no unit tests of their
own — thin wrappers, genuinely low logic surface, and the mail path is
already covered indirectly via e2e specs. Flagged by the audit as an
explicitly low-priority, optional gap in coverage completeness, not a
real bug — worth closing anyway since the actual logic each one carries
is small enough to test directly and cheaply.

## The fix: direct, focused tests for what each one actually does

`MailService` (`notification-service`'s copy, mirroring
`api/src/mail/mail.service.spec.ts`'s existing coverage) — sends via
the injected transporter, defaults the `from` address correctly, honors
`MAIL_FROM_ADDRESS` when set, passes `html` through when given.

`mail-transporter.provider.ts` — a factory function that had never been
tested in isolation. Spying on `nodemailer.createTransport()` directly
(safe: it only builds a `Transporter` object, no socket opens until
`sendMail()` is actually called) confirms the Mailpit default
(`localhost:1025`, no auth), that `MAIL_SMTP_HOST`/`MAIL_SMTP_PORT`
env vars are honored, and that `auth` is included only when
`MAIL_SMTP_USER` is set — the exact three behaviors #655's real-SMTP
support added.

`PrismaService`, identical shape in all three services (`api`,
`notification-service`, `review-analyzer`) since each is itself a
deliberate mirror of the others:

```ts
describe('PrismaService', () => {
  it('connects on module init', async () => {
    const service = new PrismaService();
    const connectSpy = jest.spyOn(service, '$connect').mockResolvedValue(undefined);
    await service.onModuleInit();
    expect(connectSpy).toHaveBeenCalled();
  });

  it('disconnects on module destroy', async () => {
    const service = new PrismaService();
    const disconnectSpy = jest.spyOn(service, '$disconnect').mockResolvedValue(undefined);
    await service.onModuleDestroy();
    expect(disconnectSpy).toHaveBeenCalled();
  });
});
```

Deliberately minimal — this class exists purely to let Nest own the
Prisma connection lifecycle, so the only behavior worth asserting is
that it actually calls `$connect()`/`$disconnect()` at the right
lifecycle hooks, nothing more.

## Verification

The tests themselves *are* the verification here — nine new test cases
across the three new/extended spec files, all passing, closing out the
one remaining coverage gap this audit's code-quality pass identified as
worth mentioning at all.
