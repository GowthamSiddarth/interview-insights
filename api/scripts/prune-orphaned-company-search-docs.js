#!/usr/bin/env node
// Prunes `companies` OpenSearch documents with no matching Postgres row
// (GitHub issue filed retroactively, Phase 20 — same "found live, not
// planned feature work" pattern as D35-D43).
//
// Root cause: OpenSearch indexing (D16) only ever happens on create —
// there is no DELETE /companies endpoint, since companies are shared and
// never deleted through normal app usage. The *only* thing that deletes a
// company row is a manual `DELETE FROM companies` during live-verification
// test cleanup (the D44-documented pattern), and that cleanup only ever
// touched Postgres. Nothing ever re-synced the index against reality, so
// every uncleaned test company accumulates as a permanent search-result
// ghost. A live sweep found 415 such ghosts (`companies` index had 420
// documents against 5 real Postgres rows) — this script is the reusable
// fix, meant to be run as part of the same test-cleanup checklist
// wiki/deployment-guide.md section 6.2 already documents for
// moderation_queue/review-search orphans (D44).
//
// Usage:
//   OPENSEARCH_URL=... DATABASE_URL=... node scripts/prune-orphaned-company-search-docs.js [--dry-run]
//
// Deliberately a standalone script, not wired into any automated job —
// company deletion itself is always a manual, deliberate test-cleanup
// action, so pruning its search-index fallout stays a manual, deliberate
// action too.

const { PrismaClient } = require('@prisma/client');
const { Client: OpenSearchClient } = require('@opensearch-project/opensearch');

const INDEX_NAME = `${process.env.OPENSEARCH_INDEX_PREFIX ?? ''}companies`;

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const prisma = new PrismaClient();
  const opensearch = new OpenSearchClient({
    node: process.env.OPENSEARCH_URL ?? 'http://localhost:9200',
  });

  const [postgresCompanies, searchResponse] = await Promise.all([
    prisma.company.findMany({ select: { id: true } }),
    opensearch.search({
      index: INDEX_NAME,
      size: 10000,
      body: { query: { match_all: {} }, _source: false },
    }),
  ]);

  const postgresIds = new Set(postgresCompanies.map((c) => c.id));
  const searchHits = searchResponse.body.hits.hits;
  const orphanedIds = searchHits.map((hit) => hit._id).filter((id) => !postgresIds.has(id));

  console.log(`Postgres companies: ${postgresIds.size}`);
  console.log(`OpenSearch '${INDEX_NAME}' documents: ${searchHits.length}`);
  console.log(`Orphaned documents (no matching Postgres row): ${orphanedIds.length}`);

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

  const bulkBody = orphanedIds.flatMap((id) => [
    { delete: { _index: INDEX_NAME, _id: id } },
  ]);
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
