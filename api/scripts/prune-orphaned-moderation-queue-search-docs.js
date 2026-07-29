#!/usr/bin/env node
// Prunes `moderation_queue` OpenSearch documents that no longer belong
// there — either the underlying entity is gone, or it's already been
// reviewed (approved/rejected/flagged) and should have been removed by
// ModerationService.review()'s own removeFromSearchIndex() call at the
// time. GitHub issue #420 (D70) — found live: a moderator's
// /moderation/search category filter was returning zero matches for a
// category that genuinely had pending entries, because OpenSearch's
// default page size (10) for a no-relevance category-only query was
// entirely filled with stale documents — burying the real ones. 60
// documents existed in the index against only 50 currently-pending
// Postgres rows.
//
// Root cause: seed-demo-data-undo.ts's best-effort search-index cleanup
// fires one removeFromSearchIndex() call per deleted entity, all in a
// single Promise.all — at real seed-run scale (D67: 1500 companies /
// 8333 candidates) that's thousands of concurrent deletes, each with
// refresh: true, against a single-node/512MB-heap OpenSearch
// (infra/docker-compose.yml). Enough of them silently failed (caught,
// logged, never retried) to leave a real backlog. seed-demo-data-undo.ts
// now batches those calls to reduce how often this happens going
// forward; this script is the reusable fix for the backlog itself,
// mirroring prune-orphaned-company-search-docs.js's exact shape (D51) —
// same "manual, deliberate action" reasoning, not wired into any
// automated job.
//
// Usage:
//   OPENSEARCH_URL=... DATABASE_URL=... node scripts/prune-orphaned-moderation-queue-search-docs.js [--dry-run]

const { PrismaClient } = require('@prisma/client');
const { Client: OpenSearchClient } = require('@opensearch-project/opensearch');

const INDEX_NAME = `${process.env.OPENSEARCH_INDEX_PREFIX ?? ''}moderation_queue`;

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const prisma = new PrismaClient();
  const opensearch = new OpenSearchClient({
    node: process.env.OPENSEARCH_URL ?? 'http://localhost:9200',
  });

  const [pendingEntries, searchResponse] = await Promise.all([
    prisma.moderationQueueEntry.findMany({
      where: { reviewedAt: null },
      select: { entityType: true, entityId: true },
    }),
    opensearch.search({
      index: INDEX_NAME,
      size: 10000,
      body: { query: { match_all: {} }, _source: false },
    }),
  ]);

  // Same `${entityType}:${entityId}` shape ModerationQueueSearchService's
  // own docId() uses — the only thing that should still be in this index.
  const pendingDocIds = new Set(pendingEntries.map((e) => `${e.entityType}:${e.entityId}`));
  const searchHits = searchResponse.body.hits.hits;
  const orphanedIds = searchHits.map((hit) => hit._id).filter((id) => !pendingDocIds.has(id));

  console.log(`Currently-pending moderation_queue rows: ${pendingDocIds.size}`);
  console.log(`OpenSearch '${INDEX_NAME}' documents: ${searchHits.length}`);
  console.log(`Orphaned documents (not currently pending): ${orphanedIds.length}`);

  if (orphanedIds.length === 0) {
    console.log('Nothing to prune.');
    await prisma.$disconnect();
    return;
  }

  if (dryRun) {
    console.log('--dry-run set, not deleting. Orphaned IDs:');
    orphanedIds.forEach((id) => console.log(`  ${id}`));
    await prisma.$disconnect();
    return;
  }

  const bulkBody = orphanedIds.flatMap((id) => [{ delete: { _index: INDEX_NAME, _id: id } }]);
  const bulkResponse = await opensearch.bulk({ body: bulkBody });

  if (bulkResponse.body.errors) {
    const failed = bulkResponse.body.items.filter(
      (item) => item.delete.status !== 200 && item.delete.status !== 404,
    );
    console.error(`${failed.length} deletions failed:`, failed.slice(0, 5));
    process.exitCode = 1;
  } else {
    console.log(`Deleted ${orphanedIds.length} orphaned documents.`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
