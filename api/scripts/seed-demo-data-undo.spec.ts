import { formatManifestList, runUndo, UndoServices } from './seed-demo-data-undo';
import { SeedManifest } from './seed-manifest';

describe('seed-demo-data-undo', () => {
  describe('formatManifestList', () => {
    it('reports nothing recorded when the list is empty', () => {
      expect(formatManifestList([])).toBe('No seed runs recorded.');
    });

    it('formats each manifest with its run id, timestamp, and counts', () => {
      const manifest: SeedManifest = {
        runId: 'run-1',
        createdAt: '2026-07-27T00:00:00.000Z',
        companyCount: 2,
        companyIds: ['company-1', 'company-2'],
        candidateIds: ['candidate-1', 'candidate-2', 'candidate-3'],
      };

      const output = formatManifestList([manifest]);

      expect(output).toContain('run-1');
      expect(output).toContain('2026-07-27T00:00:00.000Z');
      expect(output).toContain('2 companies');
      expect(output).toContain('3 candidates');
    });
  });

  describe('runUndo', () => {
    const manifest: SeedManifest = {
      runId: 'run-1',
      createdAt: '2026-07-27T00:00:00.000Z',
      companyCount: 1,
      companyIds: ['company-1'],
      candidateIds: ['candidate-1', 'candidate-2'],
    };

    interface MockPrisma {
      roundRating: { findMany: jest.Mock; deleteMany: jest.Mock };
      recruiterRating: { findMany: jest.Mock; deleteMany: jest.Mock };
      overallReview: { findMany: jest.Mock; deleteMany: jest.Mock };
      interviewProcess: { findMany: jest.Mock; deleteMany: jest.Mock };
      moderationQueueEntry: { deleteMany: jest.Mock };
      round: { deleteMany: jest.Mock };
      recruiterInteraction: { deleteMany: jest.Mock };
      candidateVerificationToken: { deleteMany: jest.Mock };
      candidate: { deleteMany: jest.Mock };
      recruiter: { deleteMany: jest.Mock };
      company: { deleteMany: jest.Mock };
      $executeRawUnsafe: jest.Mock;
      $transaction: jest.Mock;
    }

    function buildPrisma(): { prisma: MockPrisma; calls: string[] } {
      const calls: string[] = [];
      const tracked = (name: string) =>
        jest.fn(() => {
          calls.push(name);
          return Promise.resolve({ count: 0 });
        });

      const prisma: MockPrisma = {
        roundRating: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'rating-approved', status: 'approved' },
            { id: 'rating-pending', status: 'pending' },
          ]),
          deleteMany: tracked('roundRating.deleteMany'),
        },
        recruiterRating: {
          findMany: jest.fn().mockResolvedValue([{ id: 'recruiter-rating-1' }]),
          deleteMany: tracked('recruiterRating.deleteMany'),
        },
        overallReview: {
          findMany: jest.fn().mockResolvedValue([{ id: 'review-1' }]),
          deleteMany: tracked('overallReview.deleteMany'),
        },
        interviewProcess: {
          findMany: jest.fn().mockResolvedValue([{ id: 'process-1' }]),
          deleteMany: tracked('interviewProcess.deleteMany'),
        },
        moderationQueueEntry: { deleteMany: tracked('moderationQueueEntry.deleteMany') },
        round: { deleteMany: tracked('round.deleteMany') },
        recruiterInteraction: { deleteMany: tracked('recruiterInteraction.deleteMany') },
        candidateVerificationToken: { deleteMany: tracked('candidateVerificationToken.deleteMany') },
        candidate: { deleteMany: tracked('candidate.deleteMany') },
        recruiter: { deleteMany: tracked('recruiter.deleteMany') },
        company: { deleteMany: tracked('company.deleteMany') },
        $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
        $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(prisma)),
      };
      return { prisma, calls };
    }

    // Plain mock-shaped types (jest.Mock properties, not the real service
    // classes) — matching this codebase's existing mocking convention
    // (e.g. bulk-process-submission.service.spec.ts) and avoiding
    // @typescript-eslint/unbound-method false positives that a cast to the
    // real class type would trigger on every `expect(mock.method)` below.
    interface MockServices {
      prisma: MockPrisma;
      moderationService: { removeFromSearchIndex: jest.Mock };
      companySearchService: { removeCompany: jest.Mock };
      reviewSearchService: { removeReview: jest.Mock };
    }

    function buildServices(prisma: MockPrisma): MockServices {
      return {
        prisma,
        moderationService: { removeFromSearchIndex: jest.fn().mockResolvedValue(undefined) },
        companySearchService: { removeCompany: jest.fn().mockResolvedValue(undefined) },
        reviewSearchService: { removeReview: jest.fn().mockResolvedValue(undefined) },
      };
    }

    function invokeRunUndo(services: MockServices, seedManifest: SeedManifest) {
      return runUndo(services as unknown as UndoServices, seedManifest);
    }

    it('uses a longer-than-default transaction timeout, since a large seed run can exceed Prisma\'s 5000ms default against a real database', async () => {
      const { prisma } = buildPrisma();
      const services = buildServices(prisma);

      await invokeRunUndo(services, manifest);

      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 60_000 });
    });

    it('deletes in FK-safe order: moderation_queue -> ratings/reviews -> rounds/interactions -> processes/candidates -> recruiter -> company', async () => {
      const { prisma, calls } = buildPrisma();
      const services = buildServices(prisma);

      await invokeRunUndo(services, manifest);

      const recruiterIndex = calls.indexOf('recruiter.deleteMany');
      const companyIndex = calls.indexOf('company.deleteMany');
      expect(recruiterIndex).toBeGreaterThanOrEqual(0);
      expect(companyIndex).toBeGreaterThan(recruiterIndex);

      const moderationQueueIndex = calls.indexOf('moderationQueueEntry.deleteMany');
      const roundRatingIndex = calls.indexOf('roundRating.deleteMany');
      expect(moderationQueueIndex).toBeLessThan(roundRatingIndex);

      const processIndex = calls.indexOf('interviewProcess.deleteMany');
      const roundIndex = calls.indexOf('round.deleteMany');
      expect(roundIndex).toBeLessThan(processIndex);
      expect(processIndex).toBeLessThan(recruiterIndex);
    });

    it('scopes every deleteMany to exactly the ids this run created', async () => {
      const { prisma } = buildPrisma();
      const services = buildServices(prisma);

      await invokeRunUndo(services, manifest);

      expect(prisma.roundRating.deleteMany).toHaveBeenCalledWith({
        where: { candidateId: { in: manifest.candidateIds } },
      });
      expect(prisma.company.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: manifest.companyIds } },
      });
      expect(prisma.recruiter.deleteMany).toHaveBeenCalledWith({
        where: { companyId: { in: manifest.companyIds } },
      });
      expect(prisma.moderationQueueEntry.deleteMany).toHaveBeenCalledWith({
        where: { entityType: 'company', entityId: { in: manifest.companyIds } },
      });
    });

    it('only removes approved round ratings from the reviews search index', async () => {
      const { prisma } = buildPrisma();
      const services = buildServices(prisma);

      await invokeRunUndo(services, manifest);

      expect(services.reviewSearchService.removeReview).toHaveBeenCalledTimes(1);
      expect(services.reviewSearchService.removeReview).toHaveBeenCalledWith('rating-approved');
    });

    it('removes every deleted entity (all statuses) plus every company from the moderation_queue search index', async () => {
      const { prisma } = buildPrisma();
      const services = buildServices(prisma);

      await invokeRunUndo(services, manifest);

      expect(services.moderationService.removeFromSearchIndex).toHaveBeenCalledWith('round_rating', 'rating-approved');
      expect(services.moderationService.removeFromSearchIndex).toHaveBeenCalledWith('round_rating', 'rating-pending');
      expect(services.moderationService.removeFromSearchIndex).toHaveBeenCalledWith('recruiter_rating', 'recruiter-rating-1');
      expect(services.moderationService.removeFromSearchIndex).toHaveBeenCalledWith('overall_review', 'review-1');
      expect(services.moderationService.removeFromSearchIndex).toHaveBeenCalledWith('company', 'company-1');
    });

    it('best-effort removes every company from the companies search index', async () => {
      const { prisma } = buildPrisma();
      const services = buildServices(prisma);

      await invokeRunUndo(services, manifest);

      expect(services.companySearchService.removeCompany).toHaveBeenCalledWith('company-1');
    });

    it('refreshes all three materialized views', async () => {
      const { prisma } = buildPrisma();
      const services = buildServices(prisma);

      await invokeRunUndo(services, manifest);

      expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(3);
    });

    it('returns a summary of what was deleted', async () => {
      const { prisma } = buildPrisma();
      const services = buildServices(prisma);

      const summary = await invokeRunUndo(services, manifest);

      expect(summary).toEqual({
        runId: 'run-1',
        companiesDeleted: 1,
        candidatesDeleted: 2,
        processesDeleted: 1,
        roundRatingsDeleted: 2,
        recruiterRatingsDeleted: 1,
        overallReviewsDeleted: 1,
      });
    });
  });
});
