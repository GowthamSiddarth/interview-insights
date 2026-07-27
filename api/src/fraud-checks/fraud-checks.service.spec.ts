import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { FraudChecksService } from './fraud-checks.service';
import { PrismaService } from '../prisma/prisma.service';

describe('FraudChecksService', () => {
  let service: FraudChecksService;
  let prisma: {
    interviewProcess: { count: jest.Mock };
    $queryRaw: jest.Mock<Promise<{ found: boolean }[]>, [Prisma.Sql]>;
  };

  beforeEach(async () => {
    prisma = {
      interviewProcess: {
        count: jest.fn(),
      },
      $queryRaw: jest.fn<Promise<{ found: boolean }[]>, [Prisma.Sql]>(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [FraudChecksService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(FraudChecksService);
  });

  function mockSimilarityResult(found: boolean): void {
    prisma.$queryRaw.mockResolvedValue([{ found }]);
  }

  function lastQuery(): Prisma.Sql {
    const { calls } = prisma.$queryRaw.mock;
    return calls[calls.length - 1][0];
  }

  // GitHub issue #317 / docs/DECISIONS.md D52: counts InterviewProcess
  // (submission) creations, not individual round/recruiter/overall rows —
  // a single legitimate multi-round submission should never trip this on
  // its own.
  describe('checkRateLimit', () => {
    it('returns true once the candidate hits the submission threshold within the window', async () => {
      prisma.interviewProcess.count.mockResolvedValue(3);

      await expect(service.checkRateLimit('candidate-1')).resolves.toBe(true);
      expect(prisma.interviewProcess.count).toHaveBeenCalledWith({
        where: { candidateId: 'candidate-1', createdAt: { gte: expect.any(Date) as Date } },
      });
    });

    it('returns false below the submission threshold', async () => {
      prisma.interviewProcess.count.mockResolvedValue(2);

      await expect(service.checkRateLimit('candidate-1')).resolves.toBe(false);
    });
  });

  // GitHub issue #162 / D64: pg_trgm similarity computed in Postgres, not
  // an app-code full-table scan — an exact match (after normalizing
  // whitespace/case) is just the similarity-1.0 case, so these tests stay
  // exact-match to keep asserting the same guarantees D13/#317 already
  // established; near-duplicate (non-exact) matching is covered by its own
  // dedicated test below and by the e2e suite. Scoped per entity
  // type/field (GitHub issue #317): a recruiter rating's freeText is only
  // ever compared against other recruiter ratings' freeText, never
  // cross-type.
  describe('checkDuplicateFreeText', () => {
    it('returns false for empty/whitespace-only text without querying', async () => {
      await expect(service.checkDuplicateFreeText('round_rating', undefined)).resolves.toBe(false);
      await expect(service.checkDuplicateFreeText('round_rating', null)).resolves.toBe(false);
      await expect(service.checkDuplicateFreeText('round_rating', '   ')).resolves.toBe(false);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('matches an exact duplicate (case/whitespace-normalized) for round_rating', async () => {
      mockSimilarityResult(true);

      await expect(
        service.checkDuplicateFreeText('round_rating', '  Great   interview,  fair questions.  '),
      ).resolves.toBe(true);
      const query = lastQuery();
      expect(query.sql).toContain('"round_ratings"');
      expect(query.sql).toContain('"free_text"');
      expect(query.values).toEqual(['great interview, fair questions.', 0.55]);
    });

    it('matches an exact duplicate for recruiter_rating, scoped to its own table', async () => {
      mockSimilarityResult(true);

      await expect(
        service.checkDuplicateFreeText('recruiter_rating', 'very responsive, clear guidelines.'),
      ).resolves.toBe(true);
      const query = lastQuery();
      expect(query.sql).toContain('"recruiter_ratings"');
      expect(query.sql).toContain('"free_text"');
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('matches an exact duplicate for overall_review, scoped to its own table/column', async () => {
      mockSimilarityResult(true);

      await expect(
        service.checkDuplicateFreeText('overall_review', 'would recommend, great loop.'),
      ).resolves.toBe(true);
      const query = lastQuery();
      expect(query.sql).toContain('"overall_reviews"');
      expect(query.sql).toContain('"review_text"');
    });

    it('returns false when nothing matches', async () => {
      mockSimilarityResult(false);

      await expect(service.checkDuplicateFreeText('round_rating', 'unrelated review')).resolves.toBe(
        false,
      );
    });

    // The whole point of GitHub issue #162: a reworded near-duplicate
    // (not just a case/whitespace variant of the exact same text) trips
    // the check too, since the threshold decision lives in Postgres'
    // similarity() function, not app-code string equality.
    it('flags a genuine near-duplicate (reworded, not just case/whitespace) once Postgres reports it above the threshold', async () => {
      mockSimilarityResult(true);

      await expect(
        service.checkDuplicateFreeText(
          'round_rating',
          'Great interview, very fair and well-structured questions overall.',
        ),
      ).resolves.toBe(true);
      const query = lastQuery();
      expect(query.values[1]).toBe(0.55);
    });

    // GitHub issue #369 (Phase 35) — company creation requests never go
    // through fraud checks (out of scope: a company isn't a review), but
    // the switch must stay exhaustive over ModerationEntityType rather
    // than silently falling through.
    it('never flags a duplicate for the company entity type', async () => {
      await expect(service.checkDuplicateFreeText('company', 'Acme Corp')).resolves.toBe(false);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('detectFlagReason', () => {
    it('prioritizes rate_limit over duplicate when both trip', async () => {
      prisma.interviewProcess.count.mockResolvedValue(5);
      mockSimilarityResult(true);

      await expect(
        service.detectFlagReason('candidate-1', 'round_rating', 'same text'),
      ).resolves.toBe('rate_limit');
    });

    it('returns duplicate when only the duplicate check trips', async () => {
      prisma.interviewProcess.count.mockResolvedValue(0);
      mockSimilarityResult(true);

      await expect(
        service.detectFlagReason('candidate-1', 'round_rating', 'same text'),
      ).resolves.toBe('duplicate');
    });

    it('returns undefined when neither check trips', async () => {
      prisma.interviewProcess.count.mockResolvedValue(0);
      mockSimilarityResult(false);

      await expect(
        service.detectFlagReason('candidate-1', 'round_rating', 'a fresh, unique review'),
      ).resolves.toBeUndefined();
    });

    it('applies the same rate-limit signal regardless of entity type', async () => {
      prisma.interviewProcess.count.mockResolvedValue(3);
      mockSimilarityResult(false);

      await expect(
        service.detectFlagReason('candidate-1', 'recruiter_rating', undefined),
      ).resolves.toBe('rate_limit');
      await expect(
        service.detectFlagReason('candidate-1', 'overall_review', undefined),
      ).resolves.toBe('rate_limit');
    });
  });
});
