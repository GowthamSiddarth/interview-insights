import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CompaniesService } from '../src/companies/companies.service';
import { CandidatesService } from '../src/candidates/candidates.service';
import { ModerationService } from '../src/moderation/moderation.service';
import { BulkProcessSubmissionService } from '../src/bulk-process-submission/bulk-process-submission.service';
import { RoundTypeFieldOptionsService } from '../src/round-type-registry/round-type-field-options.service';
import { CompanySearchService } from '../src/search/company-search.service';
import { ReviewSearchService } from '../src/search/review-search.service';
import { ModerationQueueSearchService } from '../src/search/moderation-queue-search.service';
import { runSeed, SeedServices } from '../scripts/seed-demo-data';
import { runUndo, UndoServices } from '../scripts/seed-demo-data-undo';
import { SeedManifest } from '../scripts/seed-manifest';

// GitHub issue #406 (Phase 37) — proves a real seed-then-undo round trip
// leaves zero trace, against real Postgres + OpenSearch: every row the
// seed run created (companies, candidates, processes, rounds/recruiter
// interactions, ratings/reviews, their moderation_queue entries, and the
// shared Recruiter rows scoped to those companies) plus every search
// document it produced (companies index, reviews index, moderation_queue
// index) are all gone afterward. Manifest file I/O itself is already
// covered by scripts/seed-manifest.spec.ts's unit tests — this test
// builds the manifest object directly from runSeed()'s own summary,
// mirroring what main() does without needing real filesystem I/O.
describe('seed-demo-data-undo (e2e)', () => {
  let moduleRef: TestingModule;
  let seedServices: SeedServices;
  let undoServices: UndoServices;
  let companySearchService: CompanySearchService;
  let reviewSearchService: ReviewSearchService;
  let moderationQueueSearchService: ModerationQueueSearchService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await moduleRef.init();

    const prisma = moduleRef.get(PrismaService);
    const moderationService = moduleRef.get(ModerationService);
    companySearchService = moduleRef.get(CompanySearchService);
    reviewSearchService = moduleRef.get(ReviewSearchService);
    moderationQueueSearchService = moduleRef.get(ModerationQueueSearchService);

    seedServices = {
      prisma,
      companiesService: moduleRef.get(CompaniesService),
      candidatesService: moduleRef.get(CandidatesService),
      moderationService,
      bulkSubmissionService: moduleRef.get(BulkProcessSubmissionService),
      roundTypeFieldOptionsService: moduleRef.get(RoundTypeFieldOptionsService),
    };
    undoServices = { prisma, moderationService, companySearchService, reviewSearchService };
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('leaves zero rows and zero search documents behind after undoing a seed run', async () => {
    const summary = await runSeed(seedServices, 2);
    expect(summary.candidateIds.length).toBeGreaterThan(0);

    // Captured before the undo so we know exactly which ids to check are
    // gone afterward — the same "identify your own data by id" discipline
    // (D62) the seed generator itself already follows.
    const [roundRatingsBefore, recruiterRatingsBefore, overallReviewsBefore, recruitersBefore] = await Promise.all([
      seedServices.prisma.roundRating.findMany({
        where: { candidateId: { in: summary.candidateIds } },
        select: { id: true },
      }),
      seedServices.prisma.recruiterRating.findMany({
        where: { candidateId: { in: summary.candidateIds } },
        select: { id: true },
      }),
      seedServices.prisma.overallReview.findMany({
        where: { candidateId: { in: summary.candidateIds } },
        select: { id: true },
      }),
      seedServices.prisma.recruiter.findMany({
        where: { companyId: { in: summary.companyIds } },
        select: { id: true },
      }),
    ]);
    const companies = await seedServices.prisma.company.findMany({
      where: { id: { in: summary.companyIds } },
    });
    expect(companies).toHaveLength(2);

    const manifest: SeedManifest = {
      runId: `e2e-test-${Date.now()}`,
      createdAt: new Date().toISOString(),
      companyCount: 2,
      companyIds: summary.companyIds,
      candidateIds: summary.candidateIds,
    };

    const undoSummary = await runUndo(undoServices, manifest);
    expect(undoSummary.companiesDeleted).toBe(2);
    expect(undoSummary.candidatesDeleted).toBe(summary.candidateIds.length);

    // Postgres: every table the seed run touched has zero matching rows.
    await expect(
      seedServices.prisma.company.findMany({ where: { id: { in: summary.companyIds } } }),
    ).resolves.toHaveLength(0);
    await expect(
      seedServices.prisma.candidate.findMany({ where: { id: { in: summary.candidateIds } } }),
    ).resolves.toHaveLength(0);
    await expect(
      seedServices.prisma.interviewProcess.findMany({ where: { candidateId: { in: summary.candidateIds } } }),
    ).resolves.toHaveLength(0);
    await expect(
      seedServices.prisma.roundRating.findMany({ where: { candidateId: { in: summary.candidateIds } } }),
    ).resolves.toHaveLength(0);
    await expect(
      seedServices.prisma.recruiterRating.findMany({ where: { candidateId: { in: summary.candidateIds } } }),
    ).resolves.toHaveLength(0);
    await expect(
      seedServices.prisma.overallReview.findMany({ where: { candidateId: { in: summary.candidateIds } } }),
    ).resolves.toHaveLength(0);
    await expect(
      seedServices.prisma.recruiter.findMany({ where: { companyId: { in: summary.companyIds } } }),
    ).resolves.toHaveLength(0);
    await expect(
      seedServices.prisma.moderationQueueEntry.findMany({
        where: {
          OR: [
            { entityType: 'round_rating', entityId: { in: roundRatingsBefore.map((r) => r.id) } },
            { entityType: 'recruiter_rating', entityId: { in: recruiterRatingsBefore.map((r) => r.id) } },
            { entityType: 'overall_review', entityId: { in: overallReviewsBefore.map((r) => r.id) } },
            { entityType: 'company', entityId: { in: summary.companyIds } },
          ],
        },
      }),
    ).resolves.toHaveLength(0);

    // OpenSearch: the companies index no longer has any of these companies.
    for (const company of companies) {
      const results = await companySearchService.search(company.name);
      expect(results.some((r) => r.id === company.id)).toBe(false);
    }

    // OpenSearch: the reviews index no longer has anything for these
    // companies (covers whichever round ratings had been approved).
    for (const companyId of summary.companyIds) {
      const results = await reviewSearchService.search({ companyId });
      expect(results).toHaveLength(0);
    }

    // OpenSearch: the moderation_queue index has no leftover document for
    // any entity this run created, regardless of its moderation outcome —
    // proving removeFromSearchIndex() ran for every entity type, not just
    // the ones that happened to still be pending.
    const staleIds = new Set([
      ...roundRatingsBefore.map((r) => r.id),
      ...recruiterRatingsBefore.map((r) => r.id),
      ...overallReviewsBefore.map((r) => r.id),
      ...summary.companyIds,
    ]);
    const allQueueHits = await moderationQueueSearchService.search(undefined, undefined);
    expect(allQueueHits.some((hit) => staleIds.has(hit.entityId))).toBe(false);

    // Sanity: the seeded recruiters (if any were generated) are gone too —
    // otherwise recruitersBefore would silently be an empty array and the
    // Recruiter-row assertion above would be a false positive.
    if (recruitersBefore.length > 0) {
      await expect(
        seedServices.prisma.recruiter.findMany({ where: { id: { in: recruitersBefore.map((r) => r.id) } } }),
      ).resolves.toHaveLength(0);
    }
  });
});
