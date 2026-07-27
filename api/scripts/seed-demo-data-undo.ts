// GitHub issue #406 (Phase 37) — undoes a seed-demo-data.ts run by its
// runId, reversing that script's own write path in FK-safe order. Same
// shape MeService.eraseMe() (Phase 17 issue #151) already uses for a
// single candidate — batched here over a whole run's companies/candidates
// instead of one, plus the company-side cleanup a candidate erasure never
// needs (a candidate never deletes the shared Company/Recruiter rows it
// touched). Reuses seed-cli-utils.ts's assertSeedTargetConfirmed()
// (undoing is exactly as destructive as seeding against the wrong
// database) and refreshMaterializedViews() (an undo leaves the same three
// views stale the same way an unrefreshed seed run would).
//
// AppModule is imported dynamically inside main(), not statically at the
// top of this file — AppModule's own decorator evaluation eagerly
// requires ADMIN_JWT_SECRET/ADMIN_PASSWORD_HASH/etc. to be set
// (AdminAuthModule), which --list (enumerate manifests, no DB connection)
// has no reason to need. A static top-level import would pay that cost
// for every invocation, --list included — found by actually running
// `--list` with no admin env configured, not assumed.
//
// Usage:
//   DATABASE_URL=... npm run seed:demo-data:undo -- --list
//   DATABASE_URL=... npm run seed:demo-data:undo -- --run-id=<uuid>
//   DATABASE_URL=<not interview_insights_test> npm run seed:demo-data:undo -- --run-id=<uuid> --i-know-this-seeds-fake-data
import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { ModerationService } from '../src/moderation/moderation.service';
import { CompanySearchService } from '../src/search/company-search.service';
import { ReviewSearchService } from '../src/search/review-search.service';
import { assertSeedTargetConfirmed, parseStringArg, refreshMaterializedViews } from './seed-cli-utils';
import { SeedManifest, deleteManifest, listManifests, readManifest } from './seed-manifest';

type PrismaTransaction = Prisma.TransactionClient;

export interface UndoServices {
  prisma: PrismaService;
  moderationService: ModerationService;
  companySearchService: CompanySearchService;
  reviewSearchService: ReviewSearchService;
}

export interface UndoSummary {
  runId: string;
  companiesDeleted: number;
  candidatesDeleted: number;
  processesDeleted: number;
  roundRatingsDeleted: number;
  recruiterRatingsDeleted: number;
  overallReviewsDeleted: number;
}

// Exported so a real e2e test (test/seed-demo-data-undo.e2e-spec.ts) can
// drive this exact logic against a real Postgres/OpenSearch, matching
// runSeed()'s own testability shape.
export async function runUndo(services: UndoServices, manifest: SeedManifest): Promise<UndoSummary> {
  const { prisma, moderationService, companySearchService, reviewSearchService } = services;
  const { companyIds, candidateIds } = manifest;

  // Gathered before deletion — needed for the best-effort search-index
  // cleanup below, which (same D16/D17 reasoning as every other
  // search-index mutation in this codebase) only ever runs after the DB
  // transaction has already committed.
  const [roundRatings, recruiterRatings, overallReviews, processes] = await Promise.all([
    prisma.roundRating.findMany({
      where: { candidateId: { in: candidateIds } },
      select: { id: true, status: true },
    }),
    prisma.recruiterRating.findMany({ where: { candidateId: { in: candidateIds } }, select: { id: true } }),
    prisma.overallReview.findMany({ where: { candidateId: { in: candidateIds } }, select: { id: true } }),
    prisma.interviewProcess.findMany({ where: { candidateId: { in: candidateIds } }, select: { id: true } }),
  ]);

  const roundRatingIds = roundRatings.map((r) => r.id);
  const recruiterRatingIds = recruiterRatings.map((r) => r.id);
  const overallReviewIds = overallReviews.map((r) => r.id);
  const processIds = processes.map((p) => p.id);

  // GitHub issue #406 (Phase 37) — a real bug found running this against
  // an actual dev database, not the smaller test fixtures: Prisma's
  // default interactive-transaction timeout is 5000ms, which a large
  // seed run's batch of deleteMany calls (proportional to --companies=N,
  // against a real database with real indexes/latency rather than a
  // fresh local test one) can genuinely exceed. This is a one-off manual
  // dev-tool operation, not a request-path write competing for a
  // connection-pool slot under load, so a generous explicit timeout is
  // the right trade — holding the row locks longer is an acceptable cost
  // here, unlike in the live write paths.
  await prisma.$transaction(
    async (tx: PrismaTransaction) => {
      await tx.moderationQueueEntry.deleteMany({
        where: { entityType: 'round_rating', entityId: { in: roundRatingIds } },
      });
      await tx.moderationQueueEntry.deleteMany({
        where: { entityType: 'recruiter_rating', entityId: { in: recruiterRatingIds } },
      });
      await tx.moderationQueueEntry.deleteMany({
        where: { entityType: 'overall_review', entityId: { in: overallReviewIds } },
      });
      await tx.moderationQueueEntry.deleteMany({
        where: { entityType: 'company', entityId: { in: companyIds } },
      });

      await tx.roundRating.deleteMany({ where: { candidateId: { in: candidateIds } } });
      await tx.recruiterRating.deleteMany({ where: { candidateId: { in: candidateIds } } });
      await tx.overallReview.deleteMany({ where: { candidateId: { in: candidateIds } } });

      await tx.round.deleteMany({ where: { processId: { in: processIds } } });
      await tx.recruiterInteraction.deleteMany({ where: { processId: { in: processIds } } });

      await tx.interviewProcess.deleteMany({ where: { candidateId: { in: candidateIds } } });
      await tx.candidateVerificationToken.deleteMany({ where: { candidateId: { in: candidateIds } } });
      await tx.candidate.deleteMany({ where: { id: { in: candidateIds } } });

      // Recruiter rows are scoped one-to-one to a company
      // (@@unique([companyId, internalIdentifierHash])) with a real FK to
      // it and no cascade — must be removed before the company itself, or
      // the delete below fails with a foreign-key violation. The
      // roadmap's own design write-up for this phase omitted this step;
      // found while checking prerequisites.
      await tx.recruiter.deleteMany({ where: { companyId: { in: companyIds } } });
      await tx.company.deleteMany({ where: { id: { in: companyIds } } });
    },
    { timeout: 60_000 },
  );

  await Promise.all([
    ...roundRatings
      .filter((r) => r.status === 'approved')
      .map((r) => reviewSearchService.removeReview(r.id)),
    ...roundRatingIds.map((id) => moderationService.removeFromSearchIndex('round_rating', id)),
    ...recruiterRatingIds.map((id) => moderationService.removeFromSearchIndex('recruiter_rating', id)),
    ...overallReviewIds.map((id) => moderationService.removeFromSearchIndex('overall_review', id)),
    ...companyIds.map((id) => moderationService.removeFromSearchIndex('company', id)),
    ...companyIds.map((id) => companySearchService.removeCompany(id)),
  ]);

  await refreshMaterializedViews(prisma);

  return {
    runId: manifest.runId,
    companiesDeleted: companyIds.length,
    candidatesDeleted: candidateIds.length,
    processesDeleted: processIds.length,
    roundRatingsDeleted: roundRatingIds.length,
    recruiterRatingsDeleted: recruiterRatingIds.length,
    overallReviewsDeleted: overallReviewIds.length,
  };
}

export function formatManifestList(manifests: SeedManifest[]): string {
  if (manifests.length === 0) return 'No seed runs recorded.';
  return manifests
    .map(
      (m) =>
        `${m.runId}  ${m.createdAt}  --companies=${m.companyCount}  ` +
        `(${m.companyIds.length} companies, ${m.candidateIds.length} candidates)`,
    )
    .join('\n');
}

async function main(): Promise<void> {
  if (process.argv.includes('--list')) {
    console.log(formatManifestList(listManifests()));
    return;
  }

  const runId = parseStringArg('--run-id');
  if (!runId) {
    throw new Error(
      'Usage: npm run seed:demo-data:undo -- --run-id=<uuid>  (or --list to see available runs)',
    );
  }

  assertSeedTargetConfirmed();

  let manifest: SeedManifest;
  try {
    manifest = readManifest(runId);
  } catch {
    throw new Error(`No manifest found for run id ${runId}. Run with --list to see available runs.`);
  }

  const { AppModule } = await import('../src/app.module');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const services: UndoServices = {
      prisma: app.get(PrismaService),
      moderationService: app.get(ModerationService),
      companySearchService: app.get(CompanySearchService),
      reviewSearchService: app.get(ReviewSearchService),
    };
    const summary = await runUndo(services, manifest);
    deleteManifest(runId);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await app.close();
  }
}

// Guards against main() running on import — a future e2e test importing
// runUndo() directly shouldn't also trigger a second CLI run.
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
