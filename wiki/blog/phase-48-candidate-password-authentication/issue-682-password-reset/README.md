# Phase 48, Issue #682 — Candidate Password Reset

*Part of Phase 48 — Candidate Password Authentication.
See `docs/ROADMAP.md` Phase 48, D104.*

## A separate token table, deliberately not a shared one

The forgot-password flow needed the same hashed/single-use/short-lived
token shape `CandidateVerificationToken` already had — but as its own
table, `CandidatePasswordResetToken`, not a reuse:

```prisma
model CandidatePasswordResetToken {
  id          String    @id @default(uuid()) @db.Uuid
  candidateId String    @map("candidate_id") @db.Uuid
  tokenHash   String    @unique @map("token_hash")
  expiresAt   DateTime  @map("expires_at") @db.Timestamptz
  consumedAt  DateTime? @map("consumed_at") @db.Timestamptz
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz
  // ...
}
```

The reasoning is a security boundary, not a modeling preference: a
magic-link token and a password-reset token must never be
interchangeable. If they shared a table, a bug (or a deliberately crafted
request) that fed a leaked/guessed magic-link token into the
password-reset confirm endpoint could reset a candidate's password using
nothing but a token meant only to log them in. Two tables makes that
class of bug structurally impossible rather than something tests have to
keep proving isn't happening. Same hand-authored-migration-via-`migrate
deploy` workaround as #679 (D64).

## Closing the loop `tokenVersion` was built for

#679/#680 added `Candidate.tokenVersion` and wired
`CandidateJwtStrategy` to re-check it on every request, but nothing yet
*bumped* it. This issue is where that finally happens:

```ts
async confirmPasswordReset(token: string, newPassword: string): Promise<CandidateSessionPayload> {
  // ... token lookup, not-found/consumed/expired checks (same shape as verify()) ...

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
  const candidate = await this.prisma.$transaction(async (tx) => {
    await tx.candidatePasswordResetToken.update({ where: { id: record.id }, data: { consumedAt: new Date() } });
    return tx.candidate.update({
      where: { id: record.candidateId },
      data: { passwordHash, passwordSetAt: new Date(), tokenVersion: { increment: 1 } },
    });
  });

  return { candidateId: candidate.id, tokenVersion: candidate.tokenVersion };
}
```

The practical effect: every session cookie issued before the reset stops
working on its very next request, without needing a server-side token
blocklist or any other form of explicit revocation storage — the
`tokenVersion` mismatch `CandidateJwtStrategy` already checks handles it
for free. A fresh session is auto-issued on success (same reasoning as
register()/verify(): the candidate just proved control of the token and
chose a valid password, nothing left to gate).

## A third independent throttle, same pattern as #681

`PasswordResetThrottleGuard`/`Service` follow the exact precedent #681
set for `CandidateLoginThrottleGuard` — a fourth separate `IpThrottle`
instance now, so a throttled login or magic-link attempt from a shared IP
doesn't also block a legitimate forgot-password request.

## Verification

Unit tests cover both halves: `requestPasswordReset()`'s
enumeration-safe no-op on an unknown email (and that it *does* email + create
a token for a known one), and `confirmPasswordReset()`'s not-found/
consumed/expired cases plus the tokenVersion-increment assertion itself.
Real-Postgres e2e coverage is where the actual session-invalidation claim
gets proven: log in, capture that session's cookie, reset the password
via a separate token, then confirm the *original* cookie now 401s on
`GET /auth/me` — not just that the new password works and the old one
doesn't, but that the specific pre-reset session is dead.
