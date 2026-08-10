// docs/DECISIONS.md D96 — runs once, before any e2e spec in the suite.
// Used to also assert DATABASE_URL/OPENSEARCH_INDEX_PREFIX pointed at a
// separate interview_insights_test database (D61/D65), after an unguarded
// run once silently wrote/deleted real rows in the dev database (GitHub
// issue #383). D96 retired that separate test database — there's only one
// local Postgres/OpenSearch environment until real staging/prod infra
// exists (Phase 8b) — so every e2e run now truncates and repopulates the
// dev database directly. This is deliberate, not an oversight: revisit
// once a real non-dev environment exists to seed/test against instead.
import { truncateDatabase } from './truncate-database';

export default async function globalSetup(): Promise<void> {
  await truncateDatabase();
}
