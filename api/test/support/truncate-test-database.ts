import { PrismaClient } from '@prisma/client';
import { assertUsingTestDatabase } from './assert-test-database';

// Every table holding candidate/company-generated data, in FK-safe
// (children-before-parents) delete order — deliberately excludes
// `round_type_field_options` (admin-managed reference data seeded by
// migrations, e.g. Phase 24/#248's algorithm/data-structure options —
// wiping it would break every test relying on round-type registry
// validation) and `_prisma_migrations` (Prisma's own). `moderation_queue`
// has no real FK (its entity_id is a deliberately non-FK polymorphic
// reference, see docs/DATA_MODEL.md), so it can go first in any order.
//
// Plain `DELETE FROM`, not `TRUNCATE ... CASCADE`: an earlier version of
// this used TRUNCATE, which takes an ACCESS EXCLUSIVE lock (and swaps the
// underlying relfilenode) across every listed table simultaneously —
// empirically confirmed (A/B testing, disabling/re-enabling each half of
// this file) to intermittently 404 real, always-registered routes on a
// handful of the ~25 NestJS app instances that all try to connect and
// bootstrap in the same burst once Jest's globalSetup resolves and spawns
// every e2e file's worker at once. DELETE only needs the much weaker ROW
// EXCLUSIVE lock and never touches the relfilenode, and the tables are
// empty or near-empty at the point this runs, so its extra cost is
// negligible. Re-verified clean across multiple full-suite runs after the
// switch.
const TABLES_TO_DELETE_IN_ORDER = [
  'moderation_queue',
  'round_ratings',
  'recruiter_ratings',
  'overall_reviews',
  'company_level_mappings',
  'candidate_verification_tokens',
  'rounds',
  'recruiter_interactions',
  'interviewers',
  'recruiters',
  'interview_processes',
  'companies',
  'candidates',
];

const MATERIALIZED_VIEWS_TO_REFRESH = [
  'company_round_type_aggregates',
  'company_recruiter_aggregates',
  'company_overall_aggregates',
];

// GitHub issue #383 (D61) truncated the shared, persistent
// interview_insights_test database once by hand after stale accumulated
// data broke a real assertion. The same class of problem resurfaced
// (global-averages.e2e-spec.ts's "at least one RoundType has zero data"
// check, once every RoundType had accumulated real rows across many past
// sessions) — this automates the fix instead of repeating a manual
// one-off: every `npm run test:e2e` invocation now starts from a
// genuinely empty database, materialized views included (refreshing them
// against the now-empty base tables, since nothing else does this
// automatically — see D15).
export async function truncateTestDatabase(): Promise<void> {
  assertUsingTestDatabase('npm run test:e2e');

  const prisma = new PrismaClient();
  try {
    for (const table of TABLES_TO_DELETE_IN_ORDER) {
      await prisma.$executeRawUnsafe(`DELETE FROM "${table}";`);
    }
    for (const view of MATERIALIZED_VIEWS_TO_REFRESH) {
      await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW "${view}";`);
    }
  } finally {
    await prisma.$disconnect();
  }
}
