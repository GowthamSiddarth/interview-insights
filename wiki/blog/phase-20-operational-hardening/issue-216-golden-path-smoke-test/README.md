# Phase 20, Issue #216 — Full Golden-Path Smoke Test

*Part of Phase 20 — Operational Hardening & Live-Verification Findings.
Filed retroactively after the fact. See `docs/ROADMAP.md` Phase 20 and
`docs/DECISIONS.md` D36.*

## Why this exists: the dev-DB cleanup that prompted the question

Cleaning up the disk-pressure incident (issue #215) surfaced a second,
separate problem while poking around the dev database: it was full of
real-looking rows — `Verify150 Corp`, `Verify151 Corp`, dozens of
others — left behind by every ad-hoc Playwright verification script
this project has ever written per feature issue. Each one was a
throwaway, never checked in, and pointed at the persistent dev cluster
because that's what "verify it live" had always meant here. There was
no repeatable, safe way to exercise the whole feature set in one pass
without either writing a new throwaway script each time or leaving
exactly this kind of residue behind.

## Key concept: two decisions, both narrowing scope deliberately

Before writing any code, two structural questions got resolved:

**Format — API-only (supertest), not a real browser.** A Playwright
script driving the actual `web` UI would catch frontend/console-error
regressions too, but this project has zero Playwright dependency or
config today; adding one is a separate, larger addition (a new
dependency, a new config, a new class of flakiness to manage) that
wasn't worth bundling into solving the immediate problem. The
real-browser companion is explicitly deferred as a tracked follow-up,
not built here.

**Invocation — a separate opt-in script, never wired into
`npm run test:e2e` or CI.** The 105+ per-feature e2e specs already own
per-PR regression coverage. A large, deliberately redundant end-to-end
narrative added to every CI run would slow down every PR for a test
whose actual job is on-demand full-system sanity checking, not
per-commit gating.

## Key concept: reuse every existing pattern, invent as little as possible

`api/test/golden-path.smoke-spec.ts` walks company creation, candidate
magic-link auth, all three moderated content types, moderation
approve/reject, search, analytics, my-reviews, update/delete, and GDPR
erasure in one continuous 13-step pass — but almost nothing about *how*
it talks to the app is new. It reuses `loginAsCandidate`/`loginAsAdmin`
from the existing e2e support helpers, and the `rawPrisma = new
PrismaClient()` direct-Postgres-assertion pattern
`gdpr-erasure.e2e-spec.ts` already established for verifying things the
HTTP layer alone can't prove (that a row is *actually gone*, not just
that an endpoint returned 204).

One deliberate detail worth calling out: the test submits *three*
approved round ratings of the same type, not one. `computeShrinkageScore()`'s
hard floor is `n < 3 → null` (hard constraint #3) — a single rating
would only ever prove the well-covered null case. Three is the minimum
that proves the happy path returns a real, non-null number.

## Key concept: a runtime guard against repeating issue #215's mistake

```ts
const TEST_DATABASE_NAME = 'interview_insights_test';

export function assertUsingTestDatabase(): void {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  if (!databaseUrl.includes(TEST_DATABASE_NAME)) {
    throw new Error(`Refusing to run the golden-path smoke test: ...`);
  }
}
```

Called first thing in the spec's `beforeAll`, before any Prisma or Nest
app instance exists. This is the concrete, mechanical answer to "make
it safe to run intermittently without double-checking by hand every
time" — the exact failure mode that let the dev-DB mess accumulate
unnoticed in the first place. Deliberately scoped to just this one
spec, not retrofitted onto the other 20+ existing e2e files: those
already follow the manual-`DATABASE_URL`-override convention without
incident, and this guard exists specifically because the golden-path
spec is the one most likely to be run ad hoc, outside the routine
`npm run test:e2e` flow.

## System design approach

A dedicated Jest config (`test/jest-smoke.json`) with its own
`testRegex` (`.smoke-spec.ts$`), distinct from `jest-e2e.json`'s
`.e2e-spec.ts$` — this is what actually keeps the new spec out of
`npm run test:e2e` and CI. (A first attempt just used
`--testPathPattern golden-path` against the *same* `jest-e2e.json`
config; that pattern only narrows which tests run when you pass the
flag, but the plain `npm run test:e2e` invocation with no flag still
matched the file via the shared config's own `testRegex` — the flag
doesn't help unless the underlying config itself excludes the file.
Fixed by giving the smoke test its own config entirely, matched via a
distinct file suffix.)

## Step-by-step: what actually got built and verified

1. `api/test/support/assert-test-database.ts` — the guard above.
2. `api/test/golden-path.smoke-spec.ts` — the 13-step narrative,
   sharing one `beforeAll`-booted app for the whole file (deliberately
   *not* the fresh-app-per-test pattern every other e2e spec uses —
   this describes one continuous story with only 3 logins total across
   the whole file, nowhere near the 5-per-window magic-link/login
   throttles that made per-test isolation necessary elsewhere).
3. `test/jest-smoke.json` + a new `npm run smoke:e2e` script.
4. Verified end to end: ran it against the real test database — all 13
   steps passed. Temporarily pointed `DATABASE_URL` at the dev database
   name to confirm the guard actually refuses to run (this specific
   check ended up needing to be run by the user directly, since an
   automated permission classifier correctly declined to let an
   assistant run a command pointed at a non-test database, even
   deliberately, to prove a safety feature works — a fitting real-world
   footnote to a test whose entire purpose is proving a database-safety
   guard).
5. Ran the full existing suite alongside it — zero regressions,
   confirmed the new spec is correctly excluded from `npm run test:e2e`
   (105 tests, matching baseline exactly, both before and after).

## What this enabled — including a bug the smoke test's own stress-testing found

Beyond giving a safe, repeatable "did I break the golden path" check,
running this new spec back-to-back with the full suite dozens of times
while establishing its own reliability surfaced a real, pre-existing
correctness bug in `ModerationService.listPending()` — a transient
Prisma required-relation race that had nothing to do with the smoke
test itself, but that its stress-testing made visible. That's issue
#212 (D37), the next post in this phase.
