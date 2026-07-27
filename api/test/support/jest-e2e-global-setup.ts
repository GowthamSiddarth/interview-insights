// GitHub issue #383 / docs/DECISIONS.md D61 — runs once, before any
// e2e spec in the suite, and fails the whole run immediately if either
// local-isolation knob (D24's DATABASE_URL, D26's OPENSEARCH_INDEX_PREFIX)
// is missing. Before this existed, running `npm run test:e2e` without both
// overrides silently wrote/deleted real rows in the dev database and real
// OpenSearch indices instead of erroring — see assert-test-database.ts's
// own comment for the incident this closes.
//
// Also truncates interview_insights_test itself (docs/DECISIONS.md D65) —
// only once assertLocalE2eIsolation has confirmed DATABASE_URL genuinely
// points at the test database, and truncateTestDatabase re-checks that
// itself too before touching anything (defense in depth, given the
// severity of getting this wrong).
import { assertLocalE2eIsolation } from './assert-test-database';
import { truncateTestDatabase } from './truncate-test-database';

export default async function globalSetup(): Promise<void> {
  assertLocalE2eIsolation(
    'DATABASE_URL="postgresql://postgres:postgres@localhost:5432/interview_insights_test?schema=public" OPENSEARCH_INDEX_PREFIX="e2etest-" npm run test:e2e',
  );
  await truncateTestDatabase();
}
