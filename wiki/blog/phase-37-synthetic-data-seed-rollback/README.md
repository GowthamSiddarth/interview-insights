# Phase 37 — Synthetic Data Seed Rollback (Undo by Run ID)

*See `docs/ROADMAP.md` Phase 37.*

## The gap

Phase 19's `seed-demo-data` generator (issue #164) is genuinely useful —
it walks the real application paths (`CompaniesService` +
`ModerationService`, `BulkProcessSubmissionService`,
`RoundTypeFieldOptionsService`) to produce realistic companies,
processes, ratings, and reviews for a lower environment. What it never
had was a way back out. Undoing a run meant hand-deleting rows and
diffing OpenSearch by hand — exactly the class of manual cleanup
`docs/DECISIONS.md` D51 and D61 had already shown doesn't reliably
happen at scale, this time for dev-tool bookkeeping instead of live
incident cleanup. The generator already returned the `companyIds` it
created in its JSON summary (D62's own "identify your own data by id"
discipline) — this phase turns that habit into a real, self-contained
rollback command instead of something the caller has to act on by
hand.

## Key concept: check the design against the code before writing any

The roadmap's own design for this phase was written in one sitting and
looked complete on paper. Before touching any code, it got checked
against what the codebase actually had today — and three real gaps
turned up:

- `Summary` only tracked `companyIds`. `runSeed()` created a candidate
  per process and immediately discarded the id — there was no
  `candidateIds` array to build a manifest from at all.
- `CompanySearchService` had no delete/remove method. It could
  `indexCompany()` and `search()`, but nothing ever needed to *remove*
  a company from the index before, so that half of the class simply
  didn't exist.
- The design's own FK-safe deletion order — ratings/reviews and their
  `moderation_queue` entries, then rounds/recruiter interactions, then
  processes, then candidates, then companies — never mentioned
  `Recruiter` rows. The seed generator does create them (via
  `RecruiterInteraction`), and `Recruiter.companyId` is a real foreign
  key to `Company` with no cascade. Deleting a company before its
  `Recruiter` rows would have failed with a foreign-key violation the
  very first time a seeded company had any recruiter touchpoints.

All three were fixed as part of implementing the feature issue, not
left as surprises for later. The lesson generalizes past this one
phase: a design doc is a plan, not a fact about the codebase — the
codebase is the fact, and it's worth five minutes of grepping before
trusting a plan's own claim that "this composes existing, already-proven
pieces."

## Key concept: a local JSON manifest, not a database table

Each `seed:demo-data` run now generates a `runId` (`crypto.randomUUID()`)
and writes a manifest to `api/scripts/.seed-runs/<runId>.json`
(gitignored): the `runId`, a timestamp, the `--companies` count, and
the run's `companyIds`/`candidateIds` — the two anchors everything else
in the run hangs off of. This is deliberately a plain file, not a new
Postgres table: it's dev-tool bookkeeping for a lower-environment-only
script, not something that belongs anywhere near the production schema.
`api/scripts/seed-manifest.ts` centralizes the read/write/list/delete
logic (`writeManifest`/`readManifest`/`listManifests`/`deleteManifest`),
with a `dir` parameter defaulting to the real `.seed-runs/` directory so
unit tests can point it at a temp directory instead.

The manifest-writing itself lives in `main()`, not inside `runSeed()`.
`test/seed-demo-data.e2e-spec.ts` calls `runSeed()` directly against a
real Postgres/OpenSearch — if manifest writing lived inside `runSeed()`,
every one of those test runs would also litter the real `.seed-runs/`
directory with files nobody asked for. Keeping `runSeed()` pure and
pushing the side effect into the thin CLI wrapper is the same split
this script already used for the `assertSeedTargetConfirmed()` guard.

## Key concept: reuse the FK-safe order that already exists

`MeService.eraseMe()` (Phase 17, issue #151) already solved "delete a
whole tree of a candidate's content in the right order" for GDPR
erasure. The undo script's `runUndo()` is the same shape, batched over
a run's full `companyIds`/`candidateIds` instead of one candidate, plus
the company-side cleanup a single candidate's erasure never needs (a
candidate never deletes the shared `Company`/`Recruiter` rows it
touched — that would break someone else's data). One transaction:
`moderation_queue` entries for every entity type (including the
company's own) → ratings/reviews by `candidateId` → rounds/recruiter
interactions by `processId` → processes/candidates → `Recruiter` rows
scoped by `companyId` → companies. Outside the transaction, best-effort
removal of the `companies`/`reviews`/`moderation_queue` OpenSearch
documents (same D16/D17/D59 never-block-on-search pattern every other
write path in this app already follows), then a refresh of the three
materialized views so a stale aggregate doesn't keep reflecting rows
that no longer exist.

## A real bug found during live CLI verification, not just tests

Unit tests and even the e2e round-trip test all passed clean. Running
the actual CLI commands by hand — `npm run seed:demo-data:undo --
--list` with no admin/JWT environment configured — did not:

```
Error: ADMIN_JWT_SECRET must be set for admin authentication.
    at getRequiredAdminEnv (admin-auth/admin-auth.env.ts:9:11)
    at Object.<anonymous> (admin-auth/admin-auth.module.ts:20:34)
```

`--list` only reads local JSON files — it has no reason to touch
Postgres, OpenSearch, or admin authentication at all. But merely
*importing* anything from `seed-demo-data-undo.ts` statically imported
`AppModule`, and `AppModule`'s own decorator array eagerly evaluates
`AdminAuthModule`, which throws synchronously if `ADMIN_JWT_SECRET`
isn't set — before `main()` even runs, let alone before it checks which
flag was passed. A static top-level `import` in JS/TS can't be
conditionally skipped; the whole file is evaluated top to bottom the
moment anything requires it.

The fix: extract `assertSeedTargetConfirmed()`, `parseIntArg()`,
`parseStringArg()`, and `refreshMaterializedViews()` into a new
`api/scripts/seed-cli-utils.ts` with zero dependency on `AppModule` (it
only needs the lightweight `PrismaService` wrapper, which has no
further imports of its own) — re-exported from `seed-demo-data.ts` so
every existing import of these from that module kept working unchanged.
Then, in `seed-demo-data-undo.ts`, `AppModule` became a **dynamic**
import, resolved only inside `main()`'s `--run-id` branch, after the
`--list` early return:

```ts
if (process.argv.includes('--list')) {
  console.log(formatManifestList(listManifests()));
  return; // never touches AppModule
}
// ...
const { AppModule } = await import('../src/app.module');
const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
```

Verified directly, not assumed: `--list` now runs with a completely
empty environment, and a real `--run-id=<uuid>` run (with the actual
env configured) still boots the full app context and works end to end.

## Step-by-step: what actually got built and verified

1. `Summary.candidateIds` added; `runSeed()` now pushes every created
   candidate's id.
2. `CompanySearchService.removeCompany(id)` added, mirroring
   `ReviewSearchService.removeReview()`'s best-effort shape exactly.
3. `api/scripts/seed-manifest.ts` and `api/scripts/seed-cli-utils.ts`
   created; `seed-demo-data.ts`'s `main()` generates a `runId` and
   writes the manifest after `runSeed()` returns.
4. `api/scripts/seed-demo-data-undo.ts` built: `--list` (no DB
   connection), `--run-id=<id>` (FK-safe transactional deletion, search
   cleanup, materialized-view refresh, manifest deletion on success).
5. `package.json` gained `seed:demo-data:undo`; `.gitignore` gained
   `api/scripts/.seed-runs/`.
6. 21 new unit tests (`parseStringArg`, `seed-manifest.ts`'s full round
   trip, `seed-demo-data-undo.ts`'s deletion order/scoping/search
   cleanup via mocked Prisma, `CompanySearchService.removeCompany()`) —
   408 api unit tests total.
7. 1 new e2e test (`test/seed-demo-data-undo.e2e-spec.ts`) proves a real
   seed-then-undo round trip against real Postgres + OpenSearch leaves
   zero rows across every table the seed touched and zero documents
   across all three search indices — 166 e2e tests total.
8. `api` build/lint clean.
9. Live-verified via the real CLI against kind's Postgres/OpenSearch: a
   real `--companies=1` seed run, its manifest written correctly,
   `--list` showing it, `--run-id=<id>` deleting everything and
   reporting accurate counts, the manifest file removed on success, and
   `--list` afterward correctly showing "No seed runs recorded."

## What this enabled

Seeding a lower environment for a demo, a screenshot, or exploratory
testing is no longer a one-way door. A run's `runId` is right there in
its own output, `--list` recovers it later without digging through
scrollback, and `--run-id=<id>` leaves the database and search indices
exactly as they were before — verified, not assumed, by a test that
actually checks every table and every index comes back empty.
