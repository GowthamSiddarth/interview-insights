// Guards e2e/smoke runs against ever hitting the persistent dev database or
// its shared OpenSearch indices — the concrete answer to "make it safe to
// run intermittently without double-checking by hand every time." D24/D26
// (docs/DECISIONS.md) establish `interview_insights_test` and
// `OPENSEARCH_INDEX_PREFIX` as the two isolation knobs every local e2e run
// needs; this file originally only guarded the golden-path smoke test
// (the 2026-07-24 dev-DB cleanup incident it was built to prevent a repeat
// of), on the assumption every other e2e file "already follows the manual
// DATABASE_URL-override convention without incident." GitHub issue #383
// (D61) proved that assumption wrong — a full `npm run test:e2e` run
// without either override silently wrote/deleted real rows in the dev
// database and real OpenSearch indices, undetected until a live company
// count looked wrong. Both checks are now wired into `test/jest-e2e.json`'s
// own `globalSetup`, not just this one spec, so the whole suite fails fast
// with a clear message instead of an unprotected file ever repeating this.
const TEST_DATABASE_NAME = 'interview_insights_test';

export function assertUsingTestDatabase(command = 'npm run smoke:e2e'): void {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  if (!databaseUrl.includes(TEST_DATABASE_NAME)) {
    throw new Error(
      `Refusing to run: DATABASE_URL does not point at the ` +
        `${TEST_DATABASE_NAME} database. These tests create, moderate, and ` +
        `erase real data — they must never run against the dev database. ` +
        `Set DATABASE_URL to include "${TEST_DATABASE_NAME}" before ` +
        `running \`${command}\`.`,
    );
  }
}

// CI runs its own fully ephemeral OpenSearch service container per job
// (.github/workflows/ci.yml) — nothing shared to isolate from, so this
// check only applies to local runs against kind's shared instance (D26).
export function assertOpenSearchIndicesIsolated(command: string): void {
  if (process.env.CI) return;
  if (!process.env.OPENSEARCH_INDEX_PREFIX) {
    throw new Error(
      `Refusing to run: OPENSEARCH_INDEX_PREFIX is not set. Local e2e runs ` +
        `share kind's OpenSearch with the deployed app (docs/DECISIONS.md ` +
        `D26) — without a prefix, test documents land in the real ` +
        `companies/reviews/moderation_queue indices. Set ` +
        `OPENSEARCH_INDEX_PREFIX="e2etest-" before running \`${command}\`.`,
    );
  }
}

export function assertLocalE2eIsolation(command: string): void {
  assertUsingTestDatabase(command);
  assertOpenSearchIndicesIsolated(command);
}
