# Phase 48, Issue #680 — Candidate Password Registration + Verification Email

*Part of Phase 48 — Candidate Password Authentication.
See `docs/ROADMAP.md` Phase 48, D104.*

## Attaching a password, not creating a second account

Candidates already had a pseudonymous identity keyed by `emailHash`
(HMAC'd, never the raw email — `docs/DATA_MODEL.md` design principle 1),
resolved via an upsert every time `CandidatesService.create()` runs.
`POST /auth/register` had to respect that: a candidate who previously
only ever used the magic link must get a password *attached* to their
existing row, not a duplicate account under the same email.

```ts
async register(email: string, password: string): Promise<CandidateSessionPayload> {
  const emailHash = hashEmail(email, getEmailHashSecret());
  const existing = await this.prisma.candidate.findUnique({ where: { emailHash } });
  if (existing?.passwordHash) {
    throw new ConflictException('An account with this email already has a password set.');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const emailEncrypted = encryptEmail(email, getEmailEncryptionKey());
  const passwordSetAt = new Date();
  const candidate = await this.prisma.candidate.upsert({
    where: { emailHash },
    create: { emailHash, emailEncrypted, passwordHash, passwordSetAt },
    update: { emailEncrypted, passwordHash, passwordSetAt },
  });

  await this.issueAndSendVerificationEmail(candidate.id, email, 'verify').catch(() => undefined);
  return { candidateId: candidate.id, tokenVersion: candidate.tokenVersion };
}
```

The one guard: if a password is *already* set, registration 409s instead
of silently overwriting it — otherwise anyone who learns a candidate's
email could re-register it and take over the account.

## Reusing the magic-link token machinery for a different purpose

Rather than build a second token table and a second consume-on-click
endpoint just to confirm email ownership, `register()` reuses
`CandidateVerificationToken` and the existing `GET`/`POST /auth/verify`
consume path — the same row shape, the same single-use/expiring
semantics, just triggered by a different event with different email
copy:

```ts
private async issueAndSendVerificationEmail(
  candidateId: string,
  email: string,
  purpose: 'login' | 'verify',
): Promise<void> {
  // ... same token generation/supersession logic as requestLink() always used ...
  const subject = purpose === 'login' ? 'Your Interview Insights login link' : 'Verify your Interview Insights email';
  const action = purpose === 'login' ? 'log in' : 'verify your email';
  // ...
}
```

`requestLink()` (the pre-existing magic-link flow) was refactored to call
this same private method with `purpose: 'login'` — no behavior change for
it, just deduplication.

## Auto-login, and why no write path needed to wait for verification

`register()` issues a session cookie immediately on success, same as
`verify()` does for a clicked magic link. The reasoning: the freshly-set
password is already proof of possession strong enough to log in with
later, and grepping the rest of this codebase turned up no write path
that gates on `verificationStatus` — nothing to protect by delaying
access until the email is confirmed. The verification email is sent as a
best-effort trust signal (wrapped in `.catch(() => undefined)` — a failed
send shouldn't undo an already-durable password), not a login gate.

## The shared plumbing this issue had to lay down early

`CandidateSessionPayload` gained a `tokenVersion` field here, ahead of
#682 actually using it for anything:

```ts
export interface CandidateSessionPayload {
  candidateId: string;
  tokenVersion: number;
}
```

`CandidateJwtStrategy.validate()` now re-checks it against the database
on every authenticated request, the same "trust the database over the
token's own claims" pattern `AdminJwtStrategy` already uses for
`isActive`/`role` (D99):

```ts
async validate(payload: CandidateSessionPayload): Promise<CandidateSessionPayload> {
  const candidate = await this.prisma.candidate.findUnique({ where: { id: payload.candidateId } });
  if (!candidate || candidate.tokenVersion !== payload.tokenVersion) {
    throw new UnauthorizedException();
  }
  return { candidateId: payload.candidateId, tokenVersion: payload.tokenVersion };
}
```

This does nothing useful yet — nothing bumps `tokenVersion` until #682 —
but building the re-check now meant #682 could ship as a pure "bump one
column" change instead of also having to touch session verification.

## Verification

Unit coverage in `candidate-auth.service.spec.ts` (hashing, the 409
re-registration conflict, the best-effort email-failure case) and a new
`register-candidate.dto.spec.ts`. A `candidate-jwt.strategy.spec.ts`
regression test proves the `tokenVersion` mismatch path throws, ahead of
anything actually causing a mismatch yet. Real-Postgres e2e coverage in
`candidate-auth.e2e-spec.ts`: registering starts a session and a real
verification email lands in Mailpit; a short password 400s; re-registering
409s; and — the case that matters most for the "attach, don't duplicate"
design — a magic-link-only candidate who later registers gets the *same*
`candidateId` back, proven by decoding both sessions' JWTs.
