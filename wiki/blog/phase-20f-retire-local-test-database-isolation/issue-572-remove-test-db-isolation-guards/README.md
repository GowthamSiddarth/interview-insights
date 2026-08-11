# Phase 20f, Issue #572 — Retiring Local Test-DB Isolation

*Part of Phase 20f — Retire Local Test-Database Isolation, raised
2026-08-10 while auditing which backend features actually have frontend
consumption. Epic #571. See `docs/ROADMAP.md` Phase 20f and
`docs/DECISIONS.md` D96 for the full decision record. Issue #573 (README/
`wiki/deployment-guide.md` doc updates) shipped in the same PR but doesn't
get its own post — no new D-number, same "not every reopen gets its own
post" precedent as 20a/20c/20d/20e.*

## A guard built for a real incident, outliving the environment it protected

`interview_insights_test` and `OPENSEARCH_INDEX_PREFIX` (D24/D26) existed
because of a real incident (D61): an unguarded `npm run test:e2e` run once
silently wrote and deleted real rows in the dev database, undetected for
days. The fix at the time was defense in depth —
`assertUsingTestDatabase()`/`assertOpenSearchIndicesIsolated()` wired into
Jest's `globalSetup` so the whole e2e suite refused to run at all unless
`DATABASE_URL` pointed at the disposable test database and
`OPENSEARCH_INDEX_PREFIX` was set, plus a parallel guard
(`assertSeedTargetConfirmed()`) requiring an explicit
`--i-know-this-seeds-fake-data` flag before `seed-demo-data`/
`seed-demo-data-undo` would touch anything else.

That machinery was answering a question that stopped being live a while
ago: is there a real dev database this could accidentally contaminate,
distinct from the disposable one tests are supposed to use? This project
has exactly one Postgres instance and one OpenSearch instance locally
(`kind`'s) — no staging or production environment exists yet (Phase 8b,
not started) — and the dev database itself holds nothing but the
operator's own synthetic/seed data. There was no longer a "wrong"
database to protect against; there was only ever the one database,
wearing two names depending on which env var happened to be set. Keeping
a guard file, a truncation gate, an override flag, and ~20 lines of
usage-instruction duplication across README/`wiki/deployment-guide.md`
was judged not worth the complexity relative to the risk it protects
against today.

## Key concept: an explicit, deliberate trade — not a rollback

D96's decision isn't "the isolation guard was a mistake" — D61 was a real
incident and the guard was the right fix for the environment that existed
then. It's a re-evaluation of a trade-off as the environment changed:
retire the separate database entirely, and accept that every local
`npm run test:e2e`/`npm run smoke:e2e` run now truncates and repopulates
the dev database directly, every time, by design. `truncate-test-
database.ts` was renamed to `truncate-database.ts`
(`truncateTestDatabase()` → `truncateDatabase()`), keeping its exact
`DELETE FROM`-then-`REFRESH MATERIALIZED VIEW` behavior — only the
isolation-gate call inside it was dropped, not the truncation itself.

`api/test/support/assert-test-database.ts`
(`assertUsingTestDatabase()`/`assertOpenSearchIndicesIsolated()`/
`assertLocalE2eIsolation()`) was deleted outright rather than left inert,
per this project's own convention of not leaving unused guard code around
"just in case." `seed-cli-utils.ts`'s `assertSeedTargetConfirmed()` and
every `--i-know-this-seeds-fake-data` call site
(`seed-demo-data.ts`/`seed-demo-data-undo.ts` and their specs) went the
same way — seeding now targets whatever `DATABASE_URL` points at with no
confirmation flag required.

## Key concept: CI was never in scope

`.github/workflows/ci.yml`'s e2e job already runs against a fully
ephemeral Postgres/OpenSearch service container per job, torn down after
— it never touched the dev database in the first place, guard or no
guard. Its `interview_insights_test` database name is just a label for
that throwaway container and was deliberately left as-is rather than
renamed to match — renaming it would have been pure churn for a name that
never meant "the shared dev database" in CI's context. The
`OPENSEARCH_INDEX_PREFIX` prefixing mechanism itself
(`search-index-name.util.ts`) was left in place too, unused unless the
env var is set again — harmless to keep, and exactly the kind of
still-wired-but-dormant knob worth reusing over rebuilding if a future
non-dev environment ever needs it back.

## Step-by-step: what actually got removed and renamed

1. `api/test/support/assert-test-database.ts` deleted; its one caller
   (`jest-e2e-global-setup.ts`) now just calls `truncateDatabase()`
   directly, no gate first.
2. `truncate-test-database.ts` → `truncate-database.ts`,
   `truncateTestDatabase()` → `truncateDatabase()` — same delete-order
   list, same `DELETE FROM` (not `TRUNCATE`, to avoid the ACCESS EXCLUSIVE
   lock contention this file's own comments already document from an
   earlier bug), same materialized-view refresh.
3. `seed-cli-utils.ts`'s `assertSeedTargetConfirmed()` deleted; its three
   call sites (`seed-demo-data.ts`, `seed-demo-data-undo.ts`, and both
   specs) and every `--i-know-this-seeds-fake-data` reference removed
   along with it.
4. `golden-path.smoke-spec.ts`'s `beforeAll` no longer calls
   `assertLocalE2eIsolation()` before compiling `AppModule` — the smoke
   test's own comment now points at D96 instead of D36/D61.
5. `env-load-order.smoke-spec.ts` and `admin-session.ts` updated for the
   rename only — no behavior change, just following
   `truncate-test-database.ts` → `truncate-database.ts`.
6. `docs/DECISIONS.md` D96 written up; `docs/ROADMAP.md` gains the Phase
   20f section. README.md and `wiki/deployment-guide.md` (sections 1,
   6.1, 6.3, 6.4, 8, 11.5–11.7 — issue #573) no longer instruct a
   `DATABASE_URL` override, an `OPENSEARCH_INDEX_PREFIX` value, or
   `--i-know-this-seeds-fake-data`.

## What this enabled

One fewer database to stand up, document, and keep in sync locally — the
same `kind` Postgres instance now serves dev, e2e, smoke, and seed data
alike, and every doc that used to explain "which database, which flag,
for which command" collapsed to "just run it." The trade-off is explicit
and revisit-gated rather than silent: D96 calls out that real staging/
prod infrastructure (Phase 8b) is exactly the point to reintroduce a
dedicated, disposable database for automated runs — the same class of
protection D24/D61/D65 built, for an environment where "the only database
that exists" stops being true.
