# Phase 57, Issue #826 — Unique-Constraint Errors Leak Raw Column/Constraint Names

*Part of Phase 57 — Code Quality & Performance Hardening.
See `docs/ROADMAP.md` Phase 57, Phase 52's #779.*

## The gap

`PrismaExceptionFilter`'s `P2002` (unique constraint violation) case
built its client-facing message from `exception.meta.target` — the raw
Postgres constraint or column name, something like
`companies_slug_pending_approved_key`. Internal implementation detail,
handed directly to whoever's request tripped the constraint. Not as
severe as #779's unmapped-code leak (Phase 52 already fixed the
"completely unmapped code echoes `exception.message` verbatim" case),
but the same underlying category of problem: a caller shouldn't learn
this app's actual schema/constraint naming from an error response.

## The fix: log the real detail, return a fixed generic message

```ts
case 'P2002': {
  // GitHub issue #826 (Phase 57) — target is the raw Postgres/Prisma
  // constraint or column name (e.g. "companies_slug_pending_approved_key"),
  // an internal implementation detail, not something a caller should
  // ever see verbatim. Logged server-side for debugging; the
  // client-facing message stays fixed and generic rather than
  // trying to maintain an allow-list mapping every current (and
  // future) constraint to a friendly field name.
  const target = (exception.meta?.target as string[] | undefined)?.join(', ');
  if (target) {
    this.logger.debug(`P2002 unique constraint violated: ${target}`);
  }
  return new ConflictException('A record with these values already exists.');
}
```

The rejected alternative is worth naming: maintaining an allow-list
mapping every real constraint name to a friendly per-field message
("A company with this slug already exists," etc.) would be more
specific, but it's a maintenance burden that grows with every future
migration adding a new unique constraint — and a missed mapping would
silently fall back to leaking the raw name again anyway. A single fixed
message is less informative to the caller, genuinely, but it can never
drift out of sync with the schema the way a hand-maintained mapping
would.

## Verification

Unit tests assert the raw constraint name never appears anywhere in
the JSON response body sent to the client — only in the mocked logger
call — for both a `P2002` with a real `target` and one with no `target`
at all (same fixed message either way). Existing e2e coverage for
duplicate-slug company creation continued to pass unchanged, confirming
the *status code* (409) and overall behavior stayed identical; only the
message content narrowed.
