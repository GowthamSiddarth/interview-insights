# Phase 3, Issue #3 — Candidate Verification

*Part of Phase 3 — Trust & moderation. See `docs/ROADMAP.md` Phase 3,
`docs/DECISIONS.md` D14.*

## Why this came first

Issues #1 and #2 built signals for a moderator to judge a rating's
*content*. Issue #3 adds the other half of trust: some signal about the
*candidate* submitting it. A verified email doesn't prove someone
actually interviewed somewhere, but it raises the cost of mass-creating
throwaway accounts to spam ratings — a meaningfully different, and
complementary, kind of fraud resistance to issues #1/#2's content-level
checks.

## Key concepts

- **Single-use, expiring, hashed tokens** — the standard shape for any
  "prove you control this email/resource" flow, and worth understanding
  as a reusable pattern independent of this specific project: generate a
  high-entropy random token, store only its hash, give the token a
  lifetime, and make consuming it permanently invalidate it.
- **Issuing a new token supersedes the old one.** If a candidate requests
  a new verification token (e.g. they lost the first one, or waited too
  long), the previous still-valid token becomes invalid the moment the
  new one is issued — there should only ever be one live way to verify a
  given candidate at a time, otherwise an old, forgotten token floating
  around is a second, unnecessary attack surface.
- **A named, temporary security gap is safer than a silently assumed
  one.** This issue's headline decision (`docs/DECISIONS.md` D14) is that
  no email is actually sent — the token is returned directly in the API
  response. This is a *real* gap: anyone who can call the API on a
  candidate's behalf can verify them without ever proving they control
  that email address. The reason this is acceptable here and now is that
  it's written down explicitly, with the exact condition that would make
  it unacceptable ("before any real, non-test candidate data flows
  through this") — a future session (or a future you) can find that
  sentence and know precisely what to fix before this can go anywhere
  near real users, rather than discovering the gap by accident during an
  incident.

## Core technologies

- **`crypto.randomBytes(32)`** for the raw token — 256 bits of randomness,
  encoded as hex, is standard practice for a bearer token that needs to be
  infeasible to guess.
- **`crypto.createHash('sha256')`**, deliberately *not* HMAC, for hashing
  the token before storage — the reasoning for this distinction is the
  most reusable, transferable lesson in this whole issue (see below).
- **A dedicated `CandidateVerificationToken` table**
  (migration `20260716032724_add_candidate_verification_tokens`), separate
  from `candidates` itself — a candidate can have many tokens over time
  (superseded ones plus the current one), which doesn't fit as columns on
  the `candidates` row itself.

## The HMAC-vs-plain-hash distinction — a transferable lesson

Phase 2.1's candidate email hashing used `HMAC-SHA256` with a server-side
secret (`EMAIL_HASH_SECRET`). This issue's verification token hashing uses
a *plain* `SHA-256`, with no secret at all. That's not an inconsistency —
it's the correct choice in both cases, and the reason why is a genuinely
reusable piece of security reasoning:

- **An email address is low-entropy, guessable input.** There are only so
  many plausible email addresses, and an attacker with a list of common
  ones (or a specific target's known email) could precompute
  `SHA256(email)` for every guess and match it against the database — a
  classic rainbow-table attack. The HMAC's secret key is what makes that
  precomputation infeasible: without the secret, precomputing matching
  hashes is not viable.
- **A verification token is high-entropy, effectively unguessable
  input.** It's 256 bits of `crypto.randomBytes` output — attempting to
  guess or precompute it is infeasible regardless of whether the hash
  uses a secret pepper. The only thing that matters is that a stolen
  *hash* (e.g. a database leak) can't be reversed back into the *token*
  quickly, which a plain `SHA-256` already guarantees for any effectively-
  random 256-bit input.

The general rule this demonstrates: **whether you need a keyed hash (HMAC)
depends on the entropy of what you're hashing, not on "is this sensitive
data."** Low-entropy secrets (emails, PINs, common passwords) need a
pepper/salt to resist precomputation attacks; high-entropy secrets
(properly generated tokens, session IDs) don't need one, because
precomputation was never a viable attack against them in the first place.
Applying HMAC universally "to be safe" would work but wastes a secret-
management burden on data that never needed it; applying a bare hash
universally would leave the low-entropy case vulnerable. This project
made the correct call in both directions, and both calls are commented
in-place in the source specifically so neither gets homogenized into
"just use the same hash everywhere" by a future edit.

## System design approach

The issue/verify flow is a straightforward two-endpoint state machine:

```typescript
async issueToken(candidateId: string) {
  const { token, tokenHash } = generateVerificationToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS); // 24h

  await this.prisma.$transaction(async (tx) => {
    // Supersede any still-valid token for this candidate first.
    await tx.candidateVerificationToken.updateMany({
      where: { candidateId, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    await tx.candidateVerificationToken.create({ data: { candidateId, tokenHash, expiresAt } });
  });

  return { token, expiresAt }; // only time the raw token is ever available
}
```

`verify()` mirrors the shape of any single-use-token consumption flow,
checking three distinct failure modes with three distinct HTTP semantics
— worth internalizing as a template, since this exact three-way check
(not found / already used / expired) recurs in almost any token-based
flow (password resets, magic links, invite codes):

```typescript
async verify(token: string) {
  const record = await this.prisma.candidateVerificationToken.findUnique({
    where: { tokenHash: hashVerificationToken(token) },
  });
  if (!record) throw new NotFoundException(/* unknown token */);        // 404
  if (record.consumedAt) throw new ConflictException(/* already used */); // 409
  if (record.expiresAt < new Date()) throw new GoneException(/* expired */); // 410

  return this.prisma.$transaction(async (tx) => {
    await tx.candidateVerificationToken.update({ where: { id: record.id }, data: { consumedAt: new Date() } });
    return tx.candidate.update({ where: { id: record.candidateId }, data: { verificationStatus: 'email_verified', verifiedAt: new Date() } });
  });
}
```

Note the specific HTTP status chosen for "expired": `410 Gone`, not `404`
or `400`. The token *did* exist and was valid once — `410` communicates
"this resource used to be valid and deliberately no longer is," which is
more precise than `404`'s "never existed" or a generic `400`.

## Step-by-step: what actually got built

1. **Wrote the `CandidateVerificationToken` Prisma model** and its
   migration — `candidateId` (FK to `candidates`), `tokenHash` (unique),
   `expiresAt`, nullable `consumedAt`.
2. **Built `generateVerificationToken()`/`hashVerificationToken()`** in a
   small util module — the random-generation and hashing logic isolated
   from the service so it's independently unit-testable.
3. **Built `issueToken()`** — supersede any still-valid token, then create
   a new one, both inside one transaction so a candidate is never left
   with two simultaneously-valid tokens even under concurrent requests.
4. **Built `verify()`** — the three-way not-found/already-used/expired
   check, then atomically consume the token and flip
   `verificationStatus` to `email_verified`.
5. **Built the two endpoints**: `POST /candidates/:id/verification-token`
   and `POST /candidates/verify`.
6. **Wrote 12 unit tests** covering the token generation/hash utilities
   and both service methods' branches (mocked Prisma).
7. **Wrote `candidate-verification.e2e-spec.ts`** against a real
   Postgres — the full issue → verify → `email_verified` loop, plus
   explicit tests for token reuse (409), an unknown token (404), and
   expiry (410, using a token manually backdated in the test setup).
8. **Documented the "no email actually sent" gap** as `docs/DECISIONS.md`
   D14, with an explicit revisit trigger, rather than leaving future
   readers to discover it by reading the code closely.
9. **Fixed the fraud-checks e2e flakiness** discovered while working on
   this issue (see issue #2's post) — a good example of how working
   through one issue surfaces a real bug in a previous one, and the fix
   belongs wherever the bug actually lives, not necessarily in the
   current issue's own code.

## What this enabled

Phase 3 closed out as fully done once this issue merged — all three
GitHub issues (#1-#3) gave the platform a working moderation loop, an
automated suspicion signal on every write, and a (partial, honestly
documented) identity-verification signal. Every later phase's write path
— Phase 4's analytics reading only approved rows, Phase 5's search
indexing only approved rows — depends on the trust mechanisms this phase
built, and none of them needed to be revisited or reworked to support
those later features.
