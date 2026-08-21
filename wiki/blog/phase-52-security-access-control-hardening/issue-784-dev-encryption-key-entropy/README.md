# Phase 52, Issue #784 — Local Dev EMAIL_ENCRYPTION_KEY Is a Low-Entropy Placeholder

*Part of Phase 52 — Security & Access-Control Hardening.
See `docs/ROADMAP.md` Phase 52.*

## The gap

`EMAIL_ENCRYPTION_KEY` is the AES-256 key
`notification-service` uses to decrypt the one reversible copy of a
candidate's email this system keeps (D74) — `.env.example` documents
the shape (a 64-hex-char, 32-byte key) and how to generate a real one,
but the actual value sitting in this developer's own local, untracked
`.env` file predated that documented convention: a hand-typed string
rather than a genuinely random one. Functionally it still worked as an
AES key — any 32-byte value does — but a hand-typed value carries far
less real entropy than it looks like it does, and this key protects the
one piece of raw candidate PII this system keeps in reversible form.

## The fix: regenerate it, no code to change

The fix here has no diff to show, and that's the interesting part of
this issue rather than an omission — `.env` is gitignored
(`.gitignore`, `api/.gitignore`) by design, exactly per CLAUDE.md hard
constraint #6 ("no secret ever committed as plaintext, real or
placeholder"). The audit finding and the fix both live entirely on this
one local machine, never in git history:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

— the same command `.env.example`'s own comment above
`EMAIL_ENCRYPTION_KEY=""` already documents, pasted into the local
`.env` in place of the old hand-typed value. `EMAIL_HASH_SECRET` and
`CANDIDATE_JWT_SECRET` got the same treatment as a matter of course,
even though the audit's finding named only `EMAIL_ENCRYPTION_KEY`
specifically — no reason to leave the other two hand-typed once the
generation command was already open in a terminal.

One real constraint this key carries that makes "just regenerate it"
slightly more than a one-line fix in practice:
`notification-service`'s own `EMAIL_ENCRYPTION_KEY` has to be the
*same* value, or it can't decrypt what `api` encrypts — both local
`.env` files needed updating together, not just `api`'s.

## Verification

Nothing to unit-test — this is a local-environment hygiene fix, not
application logic. Verified by confirming the local app still boots and
a full magic-link/email round-trip still works after rotating the key in
both services' `.env` files together (a mismatched key between the two
would surface immediately as a decryption failure on the very next
email send), and by re-reading `.env.example`'s own generation
instructions to confirm the new value actually matches the documented
shape (64 hex characters).
