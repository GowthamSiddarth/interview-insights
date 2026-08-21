# Phase 55, Issue #803 — .env.example and LocalStack Seed Scripts Ship a Real, Working Key

*Part of Phase 55 — Infrastructure, CI/CD & Secrets Hardening.
See `docs/ROADMAP.md` Phase 55, `docs/SECRETS.md`.*

## The gap

`EMAIL_HASH_SECRET`/`EMAIL_ENCRYPTION_KEY`/`CANDIDATE_JWT_SECRET` are
real cryptographic keys — an HMAC key, an AES-256 encryption key, and a
JWT signing secret. `.env.example` shipped all three with a real,
*working* placeholder value (not an obviously-fake `changeme` string —
a value that would actually function as a live key if never rotated),
and both LocalStack seed scripts (`init/seed.sh`,
`infra/aws/seed-localstack.sh`) fell back to the same hardcoded values
when their own env vars were unset. CLAUDE.md's hard constraint #6 is
explicit: no secret is ever committed as plaintext, "real or
placeholder" — a working default is exactly the case that rule exists
to rule out, even when the intent is "just for local dev."

## The fix: empty by default, generated automatically where it matters

`.env.example` now ships all three as empty strings with generation
instructions in the comment above each — matching
`ADMIN_PASSWORD_HASH`/`ADMIN_JWT_SECRET`'s existing treatment:

```bash
# Generate with:
# `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
EMAIL_HASH_SECRET=""
```

Both LocalStack seed scripts now hard-require a real value instead of
falling back:

```bash
# infra/aws/seed-localstack.sh
EMAIL_HASH_SECRET="${SEED_EMAIL_HASH_SECRET:?must be set}"
```

The harder problem was the kind cluster and CD pipeline — nothing
*human* should have to generate and remember these values for a fully
automated bootstrap. `bootstrap-kind.sh` and `cd.yml` both gained an
idempotent generate-or-reuse step: read the existing value back from a
new `email-secrets` k8s Secret if one already exists (so the value
survives across restarts and redeploys instead of rotating and breaking
already-encrypted candidate emails), generate fresh random values only
if it doesn't:

```bash
EMAIL_HASH_SECRET="$(kubectl get secret email-secrets -n "$NAMESPACE" \
  -o jsonpath='{.data.EMAIL_HASH_SECRET}' 2>/dev/null | base64 -d || true)"
EMAIL_HASH_SECRET="${EMAIL_HASH_SECRET:-$(openssl rand -hex 32)}"
kubectl create secret generic email-secrets \
  --from-literal=EMAIL_HASH_SECRET="$EMAIL_HASH_SECRET" \
  # ... EMAIL_ENCRYPTION_KEY, CANDIDATE_JWT_SECRET
```

This is the same hybrid-root pattern D78 already established for
`admin-credentials`/`anthropic-credentials`: a k8s Secret feeding
LocalStack's own Secrets Manager, provisioned imperatively because
nothing else in this project's own code exists yet to fetch a value for
it. `cd.yml`'s copy uses `echo "::add-mask::$VALUE"` so a generated
value never appears in plaintext in Actions logs either.

## Verification

A full local kind-cluster bootstrap from scratch confirms the
generate-then-reuse behavior: first run generates fresh values and the
app boots correctly with them; a second run (simulating a redeploy)
reads the *same* values back rather than rotating them, confirmed by
decrypting a candidate email created during the first run and checking
it still decrypts correctly after the second run — a rotation bug here
would silently break every previously-encrypted email, exactly the
regression this idempotent design exists to prevent.
