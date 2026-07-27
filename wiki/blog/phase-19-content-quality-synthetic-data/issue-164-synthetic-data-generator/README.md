# Phase 19, Issue #164 — Synthetic Data Generator

*Part of Phase 19 — Content Quality & Synthetic Data. See `docs/ROADMAP.md`
Phase 19 and `docs/DECISIONS.md` D62.*

## Why this phase exists at all

`docs/ARCHITECTURE.md` had flagged a cold-start gap since early on: there
was no way to populate a lower environment (a fresh `kind` cluster, a
demo instance, a staging environment once one exists) with data that
actually looks like a real, populated platform — companies with a
realistic spread of review volume, some above the shrinkage floor and
some deliberately below it, moderation queues with a believable mix of
approved/pending/rejected/flagged content. Every prior "seed some data"
moment in this project's history had been a one-off script written for
a single verification session and thrown away afterward.

## Key concept: real services, not raw SQL

The single most important design decision, resolved in the kickoff
brainstorm: the generator calls the application's own real services —
`CompaniesService.create()` + `ModerationService.approve()` for the
Phase 35 company-moderation gate, `BulkProcessSubmissionService.create()`
for the real Phase 25/26 submission path, `RoundTypeFieldOptionsService`
for registry-valid `type_metadata` — rather than inserting rows directly
via raw Prisma or raw SQL. This isn't a stylistic preference. Phase 5's
own history has a concrete cautionary tale: an earlier seed script that
created a company via raw Prisma silently skipped
`CompaniesService.create()`'s OpenSearch-indexing side effect, so the
seeded company existed in Postgres but was never searchable. Calling the
real service means every side effect a real write triggers — moderation
enqueueing, search indexing, fraud checks, registry validation — happens
for synthetic data exactly the way it happens for real candidate
submissions, so the generator can never drift out of sync with what the
write paths actually do.

## Key concept: in-process, not over HTTP

The generator runs inside a `NestFactory.createApplicationContext(AppModule)`
— the same NestJS dependency-injection container the real `api` process
boots, minus the HTTP listener — rather than driving everything through
real HTTP calls against a running server. This means it can call
`CandidatesService.create()` directly to mint throwaway synthetic
candidates, bypassing the real magic-link email loop entirely (there's
no reason to actually send and click a magic link a thousand times just
to seed data), while every *content-creating* call still goes through the
real service layer described above.

## Key concept: two real bugs, not one, before this even reached the
database

**`@faker-js/faker`'s current major (10.x) ships pure ESM, with no CJS
build at all.** The moment it was imported anywhere in the repo, every
existing Jest unit test in the project broke with `Cannot use import
statement outside a module` — Jest's CJS-based module resolution simply
can't load a package with no CJS entry point. Confirmed directly by
checking the package's own `package.json`, not assumed. Fixed by pinning
to `@faker-js/faker@8.4.1`, the last major version that still ships a
real `dist/cjs` build. Documented as D62 alongside the design decisions
above — a dependency-version choice that had nothing to do with the
generator's own logic, but would have broken the entire test suite if
missed.

**Identifying "the companies this run just created" by a `createdAt >=
before` timestamp query works when the file runs alone, and silently
breaks under a full parallel `npm run test:e2e` run.** Other e2e spec
files, running as separate Jest workers against the same shared
`interview_insights_test` database, create their own companies in the
same window — a timestamp-range query can't distinguish "created by this
test" from "created by an unrelated test that happened to run at the
same moment." Fixed by having `runSeed()` return the exact `companyIds`
it created and looking those up directly by id — the same "identify your
own data by id, never a shared mutable timestamp" discipline every other
e2e spec in this codebase already follows, just newly relevant here.

## System design approach

```
api/scripts/seed-demo-data.ts
  main()                          # thin CLI entry point — arg parsing, exit codes
  runSeed(services, companyCount) # the actual logic, exported separately
                                   # so a real e2e test can drive it through
                                   # a compiled AppModule, not by shelling out
```

Two axes are varied deliberately, beyond the original issue's
review-count-only scope: **review-count distribution** per company (some
companies land under the shrinkage floor's `n = 3`, some well above it —
exercising the exact transparency rule CLAUDE.md hard constraint #3
describes), and **moderation-outcome distribution** (roughly 70%
approved, the rest a realistic pending/rejected/flagged mix, rather than
seeding only clean, already-approved content that would never exercise
the moderation queue UI at all).

Safety is a single guard, `assertSeedTargetConfirmed()` — the same class
of check as `assertLocalE2eIsolation()` (D61), but inverted in what it
allows: the e2e-isolation guard exists to make *accidentally* hitting a
real database impossible, while this guard exists to make *deliberately*
seeding a real dev/demo/staging database possible but explicit — it
requires a `--i-know-this-seeds-fake-data` flag before writing anything,
since seeding real data on purpose is this script's entire reason to
exist, unlike the e2e suite which must never touch one.

## Step-by-step: what actually got built and verified

1. **The script** — `runSeed()`/`main()` split, registry-driven
   `buildTypeMetadata()` for round `type_metadata`, the two distribution
   functions, the safety guard.
2. **The `@faker-js/faker` pin**, found and fixed before any of the
   script's own logic could even be tested.
3. **16 new unit tests** (`scripts/seed-demo-data.spec.ts`) — the safety
   guard's behavior, CLI arg parsing, the review-count/moderation-outcome
   distribution buckets via mocked `Math.random()`, and
   `buildTypeMetadata()`'s registry-scoping — which needed extending the
   root Jest config's `roots` (previously `src/` only) and the `lint`
   script (previously `{src,test}` only) to also cover `scripts/`.
4. **1 new e2e test** (`test/seed-demo-data.e2e-spec.ts`) proving the
   generator's actual *output*, not just its internal logic, against real
   Postgres + OpenSearch: every generated company is approved and
   immediately searchable (proving the real create-then-approve path ran,
   not a raw-Prisma bypass — the exact Phase 5 bug this issue's own design
   guards against), and every generated round's `type_metadata` validates
   against the real `RoundTypeFieldOptionsService` check the live write
   path enforces.
5. **The companyIds-not-timestamp fix**, found by running the full
   parallel suite rather than trusting a solo run of the new test file.
6. **A manual live run** (`--companies=2`) confirmed directly via
   `kubectl exec` psql: real registry-valid `type_metadata` like
   `problemAlgorithms`/`technologiesUsed`, a realistic status mix, and a
   real OpenSearch search hit — then cleaned up via a full truncate of
   `interview_insights_test`, which was itself found badly overdue (3,435
   stale companies had accumulated there from many past sessions never
   being truncated, per D24's own "routinely truncated" convention — a
   gap this issue's own verification happened to surface, closed properly
   a few days later by D65's automated truncation).

## What this enabled

A fresh `kind` cluster, a demo instance, or a future staging environment
can now go from empty to populated-and-believable with one command,
exercising the shrinkage floor, the moderation queue's full status mix,
and search — the exact cold-start gap `docs/ARCHITECTURE.md` had been
carrying since Phase 1 — without anyone hand-writing a one-off script
that immediately falls out of sync with whatever the write paths
actually require next.
