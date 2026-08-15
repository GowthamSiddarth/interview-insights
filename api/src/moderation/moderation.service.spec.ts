import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ModerationService } from './moderation.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewSearchService } from '../search/review-search.service';
import { CompanySearchService } from '../search/company-search.service';
import { ModerationQueueSearchService } from '../search/moderation-queue-search.service';
import { DomainEventPublisher } from '../events/domain-event-publisher';

// GitHub issue #486 — computeSlaDeadline() is Date.now()-based, not
// injectable, so assertions use a tolerance window rather than an exact
// timestamp match.
function expectSlaDeadlineHoursFromNow(deadline: unknown, hours: number) {
  expect(deadline).toBeInstanceOf(Date);
  const diffMs = (deadline as Date).getTime() - Date.now();
  expect(Math.abs(diffMs - hours * 60 * 60 * 1000)).toBeLessThan(5000);
}

// `process.env.X = undefined` stringifies to "undefined" rather than
// unsetting the var — restoring an originally-unset value needs `delete`.
function restoreEnv(key: string, original: string | undefined) {
  if (original === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = original;
  }
}

// jest.Mock's `.mock.calls` is untyped (`any`) — this narrows the one shape
// this spec cares about instead of scattering unsafe member accesses.
interface CreateCallData {
  entityType: string;
  entityId: string;
  slaDeadline: unknown;
}
function getCreateCallData(createMock: jest.Mock): CreateCallData {
  const [args] = createMock.mock.calls[0] as [{ data: CreateCallData }];
  return args.data;
}

// GitHub issue #674 (Phase 47, D104) — review()'s reviewedAt gate moved
// from a plain findUniqueOrThrow + update to an atomic updateMany (see
// moderation.service.ts's own comment on why). This mimics that atomicity
// in the mock: updateMany only "succeeds" (count: 1) while reviewedAt is
// still null, matching real Postgres's row-lock-then-recheck behavior for
// concurrent callers, and findUniqueOrThrow reflects whatever the last
// successful updateMany wrote — so a caller's `result` and a
// second-caller's ConflictException both come out the same as they would
// against a real database.
function mockPendingQueueEntry(
  prisma: {
    moderationQueueEntry: { findUniqueOrThrow: jest.Mock; updateMany: jest.Mock };
  },
  entry: { id: string; entityType: string; entityId: string },
) {
  const state: Record<string, unknown> = { ...entry, reviewedAt: null, flagReason: null };
  prisma.moderationQueueEntry.findUniqueOrThrow.mockImplementation(() => Promise.resolve({ ...state }));
  prisma.moderationQueueEntry.updateMany.mockImplementation((args: { data: object }) => {
    if (state.reviewedAt !== null) return Promise.resolve({ count: 0 });
    Object.assign(state, args.data);
    return Promise.resolve({ count: 1 });
  });
  return state;
}

describe('ModerationService', () => {
  let service: ModerationService;
  let prisma: {
    moderationQueueEntry: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      delete: jest.Mock;
      deleteMany: jest.Mock;
    };
    roundRating: {
      update: jest.Mock;
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      findMany: jest.Mock;
    };
    recruiterRating: {
      update: jest.Mock;
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      findMany: jest.Mock;
    };
    overallReview: {
      update: jest.Mock;
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      findMany: jest.Mock;
    };
    company: {
      update: jest.Mock;
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      findMany: jest.Mock;
    };
    aiAutoApprovalAudit: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let reviewSearchService: { indexReview: jest.Mock };
  let companySearchService: { indexCompany: jest.Mock };
  let moderationQueueSearchService: {
    indexEntry: jest.Mock;
    removeEntry: jest.Mock;
    search: jest.Mock;
  };
  let domainEventPublisher: { publish: jest.Mock };

  beforeEach(async () => {
    prisma = {
      moderationQueueEntry: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      roundRating: {
        update: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      recruiterRating: {
        update: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      overallReview: {
        update: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      company: {
        update: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      aiAutoApprovalAudit: { create: jest.fn().mockResolvedValue(undefined) },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(prisma)),
    };
    reviewSearchService = { indexReview: jest.fn().mockResolvedValue(undefined) };
    companySearchService = { indexCompany: jest.fn().mockResolvedValue(undefined) };
    moderationQueueSearchService = {
      indexEntry: jest.fn().mockResolvedValue(undefined),
      removeEntry: jest.fn().mockResolvedValue(undefined),
      search: jest.fn().mockResolvedValue([]),
    };
    domainEventPublisher = { publish: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModerationService,
        { provide: PrismaService, useValue: prisma },
        { provide: ReviewSearchService, useValue: reviewSearchService },
        { provide: CompanySearchService, useValue: companySearchService },
        { provide: ModerationQueueSearchService, useValue: moderationQueueSearchService },
        { provide: DomainEventPublisher, useValue: domainEventPublisher },
      ],
    }).compile();

    service = module.get(ModerationService);
  });

  describe('enqueue', () => {
    it('creates a moderation_queue row for the given entity, with a default 48h SLA deadline', async () => {
      prisma.moderationQueueEntry.create.mockResolvedValue({ id: 'queue-1' });

      await service.enqueue('round_rating', 'rating-1');

      const data = getCreateCallData(prisma.moderationQueueEntry.create);
      expect(data.entityType).toBe('round_rating');
      expect(data.entityId).toBe('rating-1');
      expectSlaDeadlineHoursFromNow(data.slaDeadline, 48);
    });

    it('honors MODERATION_SLA_HOURS when set', async () => {
      const original = process.env.MODERATION_SLA_HOURS;
      process.env.MODERATION_SLA_HOURS = '12';
      try {
        prisma.moderationQueueEntry.create.mockResolvedValue({ id: 'queue-1' });

        await service.enqueue('round_rating', 'rating-1');

        expectSlaDeadlineHoursFromNow(getCreateCallData(prisma.moderationQueueEntry.create).slaDeadline, 12);
      } finally {
        restoreEnv('MODERATION_SLA_HOURS', original);
      }
    });

    it('rejects a non-positive MODERATION_SLA_HOURS', () => {
      const original = process.env.MODERATION_SLA_HOURS;
      process.env.MODERATION_SLA_HOURS = '0';
      try {
        expect(() => service.enqueue('round_rating', 'rating-1')).toThrow(
          'MODERATION_SLA_HOURS must be a positive number, got "0".',
        );
      } finally {
        restoreEnv('MODERATION_SLA_HOURS', original);
      }
    });

    it('uses the provided transaction client instead of the default one', async () => {
      const tx = { moderationQueueEntry: { create: jest.fn().mockResolvedValue({ id: 'queue-1' }) } };

      await service.enqueue('round_rating', 'rating-1', tx as never);

      expect(tx.moderationQueueEntry.create).toHaveBeenCalled();
      expect(prisma.moderationQueueEntry.create).not.toHaveBeenCalled();
    });
  });

  describe('reenqueue', () => {
    it('deletes any still-unreviewed entry for the entity before creating a fresh one, with a fresh SLA deadline', async () => {
      prisma.moderationQueueEntry.deleteMany.mockResolvedValue({ count: 1 });
      prisma.moderationQueueEntry.create.mockResolvedValue({ id: 'queue-2' });

      await service.reenqueue('round_rating', 'rating-1');

      expect(prisma.moderationQueueEntry.deleteMany).toHaveBeenCalledWith({
        where: { entityType: 'round_rating', entityId: 'rating-1', reviewedAt: null },
      });
      const data = getCreateCallData(prisma.moderationQueueEntry.create);
      expect(data.entityType).toBe('round_rating');
      expect(data.entityId).toBe('rating-1');
      expectSlaDeadlineHoursFromNow(data.slaDeadline, 48);
    });

    it('uses the provided transaction client instead of the default one', async () => {
      const tx = {
        moderationQueueEntry: {
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          create: jest.fn().mockResolvedValue({ id: 'queue-2' }),
        },
      };

      await service.reenqueue('round_rating', 'rating-1', tx as never);

      expect(tx.moderationQueueEntry.deleteMany).toHaveBeenCalled();
      expect(tx.moderationQueueEntry.create).toHaveBeenCalled();
      expect(prisma.moderationQueueEntry.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('removeQueueEntries', () => {
    it('deletes every entry for the entity, reviewed or not', async () => {
      prisma.moderationQueueEntry.deleteMany.mockResolvedValue({ count: 1 });

      await service.removeQueueEntries('round_rating', 'rating-1');

      expect(prisma.moderationQueueEntry.deleteMany).toHaveBeenCalledWith({
        where: { entityType: 'round_rating', entityId: 'rating-1' },
      });
    });
  });

  describe('listPending', () => {
    it('only returns unreviewed entries, most urgent (earliest slaDeadline) first', async () => {
      prisma.moderationQueueEntry.findMany.mockResolvedValue([]);

      await service.listPending();

      expect(prisma.moderationQueueEntry.findMany).toHaveBeenCalledWith({
        where: { reviewedAt: null },
        orderBy: { slaDeadline: 'asc' },
        include: { claimedBy: { select: { id: true, username: true } } },
      });
    });

    // GitHub issue #522 (Phase 41) — GET /moderation/queue's own filters.
    describe('filters', () => {
      it('narrows by entityType', async () => {
        prisma.moderationQueueEntry.findMany.mockResolvedValue([]);

        await service.listPending({ entityType: 'round_rating' });

        expect(prisma.moderationQueueEntry.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: { reviewedAt: null, entityType: 'round_rating' } }),
        );
      });

      it("claimState 'mine' filters to the given moderatorId", async () => {
        prisma.moderationQueueEntry.findMany.mockResolvedValue([]);

        await service.listPending({ claimState: 'mine', moderatorId: 'moderator-1' });

        expect(prisma.moderationQueueEntry.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: { reviewedAt: null, claimedById: 'moderator-1' } }),
        );
      });

      it("claimState 'unclaimed' filters to claimedById: null", async () => {
        prisma.moderationQueueEntry.findMany.mockResolvedValue([]);

        await service.listPending({ claimState: 'unclaimed' });

        expect(prisma.moderationQueueEntry.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: { reviewedAt: null, claimedById: null } }),
        );
      });

      it("claimState 'all' applies no claim filter", async () => {
        prisma.moderationQueueEntry.findMany.mockResolvedValue([]);

        await service.listPending({ claimState: 'all' });

        expect(prisma.moderationQueueEntry.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: { reviewedAt: null } }),
        );
      });

      it("status: ['pending'] filters to flagReason: null", async () => {
        prisma.moderationQueueEntry.findMany.mockResolvedValue([]);

        await service.listPending({ status: ['pending'] });

        expect(prisma.moderationQueueEntry.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: { reviewedAt: null, flagReason: null } }),
        );
      });

      it("status: ['flagged'] filters to flagReason not null", async () => {
        prisma.moderationQueueEntry.findMany.mockResolvedValue([]);

        await service.listPending({ status: ['flagged'] });

        expect(prisma.moderationQueueEntry.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: { reviewedAt: null, flagReason: { not: null } } }),
        );
      });

      it('status covering both values applies no flagReason filter, same as omitting it', async () => {
        prisma.moderationQueueEntry.findMany.mockResolvedValue([]);

        await service.listPending({ status: ['pending', 'flagged'] });

        expect(prisma.moderationQueueEntry.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: { reviewedAt: null } }),
        );
      });

      it('companyId resolves matching entityType/entityId pairs across all three rated entity types plus company itself, and ORs them in', async () => {
        prisma.roundRating.findMany.mockResolvedValueOnce([{ id: 'rr1' }]);
        prisma.recruiterRating.findMany.mockResolvedValueOnce([{ id: 'cr1' }]);
        prisma.overallReview.findMany.mockResolvedValueOnce([{ id: 'ov1' }]);
        prisma.moderationQueueEntry.findMany.mockResolvedValue([]);

        await service.listPending({ companyId: 'company-1' });

        expect(prisma.roundRating.findMany).toHaveBeenCalledWith({
          where: { round: { process: { companyId: 'company-1' } } },
          select: { id: true },
        });
        expect(prisma.recruiterRating.findMany).toHaveBeenCalledWith({
          where: { recruiterInteraction: { process: { companyId: 'company-1' } } },
          select: { id: true },
        });
        expect(prisma.overallReview.findMany).toHaveBeenCalledWith({
          where: { process: { companyId: 'company-1' } },
          select: { id: true },
        });
        expect(prisma.moderationQueueEntry.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              reviewedAt: null,
              OR: [
                { entityType: 'round_rating', entityId: 'rr1' },
                { entityType: 'recruiter_rating', entityId: 'cr1' },
                { entityType: 'overall_review', entityId: 'ov1' },
                { entityType: 'company', entityId: 'company-1' },
              ],
            },
          }),
        );
      });

      it('companyId scoped to a specific entityType only queries that one type for company-scoping (enrichEntries below still fetches every type, but with empty ids)', async () => {
        prisma.roundRating.findMany.mockResolvedValueOnce([{ id: 'rr1' }]);
        prisma.moderationQueueEntry.findMany.mockResolvedValue([]);

        await service.listPending({ companyId: 'company-1', entityType: 'round_rating' });

        expect(prisma.roundRating.findMany).toHaveBeenCalledWith({
          where: { round: { process: { companyId: 'company-1' } } },
          select: { id: true },
        });
        expect(prisma.recruiterRating.findMany).not.toHaveBeenCalledWith(
          expect.objectContaining({
            where: { recruiterInteraction: { process: { companyId: 'company-1' } } },
          }),
        );
        expect(prisma.overallReview.findMany).not.toHaveBeenCalledWith(
          expect.objectContaining({ where: { process: { companyId: 'company-1' } } }),
        );
        expect(prisma.moderationQueueEntry.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              reviewedAt: null,
              entityType: 'round_rating',
              OR: [{ entityType: 'round_rating', entityId: 'rr1' }],
            },
          }),
        );
      });

      // The 'company' ref is always a candidate for the OR (its own
      // entityId trivially equals companyId) unless entityType excludes
      // it — so only a non-company entityType with zero matches can ever
      // produce a genuinely empty refs list.
      it('companyId scoped to a non-company entityType with no matches short-circuits to an empty result without querying moderation_queue', async () => {
        prisma.roundRating.findMany.mockResolvedValueOnce([]);

        const result = await service.listPending({ companyId: 'company-with-nothing', entityType: 'round_rating' });

        expect(result).toEqual([]);
        expect(prisma.moderationQueueEntry.findMany).not.toHaveBeenCalled();
      });
    });

    it('self-heals a pending entry missing from the search index (its write-time indexForSearch() call never landed)', async () => {
      prisma.moderationQueueEntry.findMany.mockResolvedValue([
        { id: 'q1', entityType: 'company', entityId: 'company-1', reviewedAt: null },
      ]);
      const company = {
        id: 'company-1',
        name: 'Marker Verify Co',
        slug: 'marker-verify-co',
        sizeBucket: 'mid',
        industry: null,
        createdAt: new Date('2026-01-01'),
      };
      prisma.company.findMany.mockResolvedValue([company]);
      prisma.company.findUnique.mockResolvedValue(company);

      await service.listPending();

      expect(moderationQueueSearchService.indexEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'company',
          entityId: 'company-1',
          category: 'create-company',
          companyName: 'Marker Verify Co',
        }),
      );
    });

    it('does not attempt to re-index an entry whose entity failed to enrich (entity: null, a transient D37 failure)', async () => {
      prisma.moderationQueueEntry.findMany.mockResolvedValue([
        { id: 'q1', entityType: 'round_rating', entityId: 'rr1', reviewedAt: null },
      ]);
      prisma.roundRating.findMany.mockRejectedValue(new Error('transient'));

      await service.listPending();

      expect(moderationQueueSearchService.indexEntry).not.toHaveBeenCalled();
    });

    it('groups entries from the same process into one group, enriched with only generated labels — never the identifier hash', async () => {
      prisma.moderationQueueEntry.findMany.mockResolvedValue([
        { id: 'q1', entityType: 'round_rating', entityId: 'rr1', reviewedAt: null },
        { id: 'q2', entityType: 'recruiter_rating', entityId: 'cr1', reviewedAt: null },
        { id: 'q3', entityType: 'overall_review', entityId: 'ov1', reviewedAt: null },
      ]);
      prisma.roundRating.findMany.mockResolvedValue([
        {
          id: 'rr1',
          difficulty: 3,
          fluency: 4,
          clarity: 4,
          focus: 4,
          technicalDepth: null,
          freeText: 'tough but fair',
          moderationVerdict: { concerning: false, reasons: [], summary: 'Looks fine.' },
          round: {
            title: 'Screen',
            roundType: 'coding',
            description: 'A live coding round',
            typeMetadata: { problemAlgorithms: ['DFS'] },
            scheduledDurationMinutes: 45,
            process: { id: 'process-1', roleTitle: 'Engineer', company: { name: 'Acme' } },
          },
        },
      ]);
      prisma.recruiterRating.findMany.mockResolvedValue([
        {
          id: 'cr1',
          reachability: 5,
          responsiveness: 4,
          guidelinesShared: 5,
          rejectionMessageAuthenticity: null,
          freeText: null,
          moderationVerdict: null,
          recruiterInteraction: {
            recruiter: { displayLabel: 'Recruiter A', internalIdentifierHash: 'deadbeef' },
            process: { id: 'process-1', roleTitle: 'Engineer', company: { name: 'Acme' } },
          },
        },
      ]);
      prisma.overallReview.findMany.mockResolvedValue([
        {
          id: 'ov1',
          overallExperience: 4,
          wouldRecommend: true,
          reviewText: 'good loop',
          process: { id: 'process-1', roleTitle: 'Engineer', company: { name: 'Acme' } },
        },
      ]);

      const result = await service.listPending();

      // GitHub issue #315 — all three belong to the same process, so
      // they come back as exactly one group.
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ processId: 'process-1', companyName: 'Acme', roleTitle: 'Engineer' });
      expect(result[0].entries).toHaveLength(3);

      expect(result[0].entries[0].entity).toMatchObject({
        companyName: 'Acme',
        roundTitle: 'Screen',
        roundDescription: 'A live coding round',
        roundTypeMetadata: { problemAlgorithms: ['DFS'] },
        roundScheduledDurationMinutes: 45,
        difficulty: 3,
        freeText: 'tough but fair',
        // GitHub issue #163 (Phase 19) — the advisory LLM verdict rides
        // along in the same enrichment pass, for the moderator UI to show.
        moderationVerdict: { concerning: false, reasons: [], summary: 'Looks fine.' },
      });
      expect(result[0].entries[1].entity).toMatchObject({
        recruiterLabel: 'Recruiter A',
        reachability: 5,
        // Null is a valid, unremarkable state (feature disabled, or the
        // triage call hasn't landed yet) — not itself a signal.
        moderationVerdict: null,
      });
      expect(JSON.stringify(result)).not.toContain('deadbeef');
      expect(result[0].entries[2].entity).toMatchObject({
        overallExperience: 4,
        wouldRecommend: true,
      });
    });

    it('puts entries from different processes into separate groups', async () => {
      prisma.moderationQueueEntry.findMany.mockResolvedValue([
        { id: 'q1', entityType: 'round_rating', entityId: 'rr1', reviewedAt: null },
        { id: 'q2', entityType: 'round_rating', entityId: 'rr2', reviewedAt: null },
      ]);
      prisma.roundRating.findMany.mockResolvedValue([
        {
          id: 'rr1',
          difficulty: 3,
          fluency: 4,
          clarity: 4,
          focus: 4,
          technicalDepth: null,
          freeText: null,
          round: {
            title: 'Screen',
            roundType: 'coding',
            description: null,
            typeMetadata: null,
            scheduledDurationMinutes: null,
            process: { id: 'process-1', roleTitle: 'Engineer', company: { name: 'Acme' } },
          },
        },
        {
          id: 'rr2',
          difficulty: 3,
          fluency: 4,
          clarity: 4,
          focus: 4,
          technicalDepth: null,
          freeText: null,
          round: {
            title: 'Onsite',
            roundType: 'system_design',
            description: null,
            typeMetadata: null,
            scheduledDurationMinutes: null,
            process: { id: 'process-2', roleTitle: 'Manager', company: { name: 'Globex' } },
          },
        },
      ]);

      const result = await service.listPending();

      expect(result).toHaveLength(2);
      expect(result[0].processId).toBe('process-1');
      expect(result[1].processId).toBe('process-2');
    });

    // GitHub issue #383 / docs/DECISIONS.md D61: a genuinely missing
    // entity (the batch fetch succeeded, this id just wasn't in the
    // results) only ever happens via a raw-SQL deletion bypassing
    // removeQueueEntries() — self-heal by removing the stale entry
    // rather than surfacing it forever as "Unknown · Unknown".
    it('self-heals a genuinely orphaned entry: removed from results, the queue row, and the search index', async () => {
      prisma.moderationQueueEntry.findMany.mockResolvedValue([
        { id: 'q1', entityType: 'round_rating', entityId: 'gone', reviewedAt: null },
      ]);

      const result = await service.listPending();

      expect(result).toHaveLength(0);
      expect(prisma.moderationQueueEntry.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['q1'] } } });
      expect(moderationQueueSearchService.removeEntry).toHaveBeenCalledWith('round_rating', 'gone');
    });

    // GitHub issue #212 / docs/DECISIONS.md D37: a required-relation
    // include (e.g. recruiterRating -> recruiterInteraction -> process)
    // can transiently reject if Prisma splits the nested include across
    // multiple round trips and a concurrent delete (GDPR erasure, #151;
    // Update/Delete, #150) commits in between — one entity type's
    // enrichment failing must never crash the other two, or the whole
    // endpoint.
    it('degrades one entity type to entity: null on a transient enrichment failure, without affecting the other two', async () => {
      prisma.moderationQueueEntry.findMany.mockResolvedValue([
        { id: 'q1', entityType: 'round_rating', entityId: 'rr1', reviewedAt: null },
        { id: 'q2', entityType: 'recruiter_rating', entityId: 'cr1', reviewedAt: null },
        { id: 'q3', entityType: 'overall_review', entityId: 'ov1', reviewedAt: null },
      ]);
      prisma.roundRating.findMany.mockResolvedValue([
        {
          id: 'rr1',
          difficulty: 3,
          fluency: 4,
          clarity: 4,
          focus: 4,
          technicalDepth: null,
          freeText: null,
          round: {
            title: 'Screen',
            roundType: 'coding',
            description: null,
            typeMetadata: null,
            scheduledDurationMinutes: null,
            process: { id: 'process-1', roleTitle: 'Engineer', company: { name: 'Acme' } },
          },
        },
      ]);
      prisma.recruiterRating.findMany.mockRejectedValue(
        new Error('Inconsistent query result: Field process is required to return data, got `null` instead.'),
      );
      prisma.overallReview.findMany.mockResolvedValue([
        {
          id: 'ov1',
          overallExperience: 4,
          wouldRecommend: true,
          reviewText: 'good loop',
          process: { id: 'process-2', roleTitle: 'Engineer', company: { name: 'Acme' } },
        },
      ]);

      const result = await service.listPending();

      const roundGroup = result.find((g) => g.processId === 'process-1');
      const failedGroup = result.find((g) => g.processId === null);
      const overallGroup = result.find((g) => g.processId === 'process-2');

      expect(roundGroup?.entries[0].entity).toMatchObject({ roundTitle: 'Screen' });
      expect(failedGroup?.entries[0].entity).toBeNull();
      expect(overallGroup?.entries[0].entity).toMatchObject({ overallExperience: 4 });
    });

    // GitHub issue #369 (Phase 35) — a pending company-creation request
    // has no InterviewProcess to group by; each one gets its own
    // standalone group instead.
    it('enriches a pending company-creation request in its own standalone group', async () => {
      prisma.moderationQueueEntry.findMany.mockResolvedValue([
        { id: 'q1', entityType: 'company', entityId: 'company-1', reviewedAt: null },
      ]);
      prisma.company.findMany.mockResolvedValue([
        {
          id: 'company-1',
          name: 'Acme Corp',
          slug: 'acme-corp',
          sizeBucket: 'mid',
          industry: 'Tech',
        },
      ]);

      const result = await service.listPending();

      expect(result).toHaveLength(1);
      expect(result[0].companyName).toBe('Acme Corp');
      expect(result[0].entries[0].entity).toMatchObject({
        companyName: 'Acme Corp',
        requestedCompanySlug: 'acme-corp',
        requestedCompanySizeBucket: 'mid',
        requestedCompanyIndustry: 'Tech',
      });
    });

    it('puts two separate company-creation requests into two separate groups', async () => {
      prisma.moderationQueueEntry.findMany.mockResolvedValue([
        { id: 'q1', entityType: 'company', entityId: 'company-1', reviewedAt: null },
        { id: 'q2', entityType: 'company', entityId: 'company-2', reviewedAt: null },
      ]);
      prisma.company.findMany.mockResolvedValue([
        { id: 'company-1', name: 'Acme Corp', slug: 'acme-corp', sizeBucket: 'mid', industry: null },
        { id: 'company-2', name: 'Globex', slug: 'globex', sizeBucket: 'large', industry: null },
      ]);

      const result = await service.listPending();

      expect(result).toHaveLength(2);
    });
  });

  describe('approve / reject / flag', () => {
    function mockPendingRoundRatingEntry() {
      mockPendingQueueEntry(prisma, { id: 'queue-1', entityType: 'round_rating', entityId: 'rating-1' });
      prisma.roundRating.update.mockResolvedValue({ id: 'rating-1', status: 'approved' });
      prisma.roundRating.findUniqueOrThrow.mockResolvedValue({
        id: 'rating-1',
        roundId: 'round-1',
        candidateId: 'candidate-1',
        freeText: 'Great round',
        createdAt: new Date('2026-01-01'),
        difficulty: 3,
        fluency: 4,
        clarity: 4,
        focus: 4,
        round: {
          roundType: 'coding',
          process: { companyId: 'company-1', roleTitle: 'Engineer' },
        },
      });
    }

    it('approve() flips the round rating to approved and stamps the queue entry reviewed', async () => {
      mockPendingRoundRatingEntry();

      const result = await service.approve('queue-1', { reviewedBy: 'gowtham' });

      expect(prisma.roundRating.update).toHaveBeenCalledWith({
        where: { id: 'rating-1' },
        data: { status: 'approved' },
      });
      expect(prisma.moderationQueueEntry.updateMany).toHaveBeenCalledWith({
        where: { id: 'queue-1', reviewedAt: null },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any() is typed `any` by @types/jest
        data: { reviewedAt: expect.any(Date), reviewedBy: 'gowtham', flagReason: undefined },
      });
      expect(result).toMatchObject({ reviewedBy: 'gowtham' });
    });

    it('approve() indexes the approved review into OpenSearch', async () => {
      mockPendingRoundRatingEntry();

      await service.approve('queue-1', {});

      expect(reviewSearchService.indexReview).toHaveBeenCalledWith({
        id: 'rating-1',
        companyId: 'company-1',
        roleTitle: 'Engineer',
        roundType: 'coding',
        freeText: 'Great round',
        createdAt: new Date('2026-01-01'),
        difficulty: 3,
        fluency: 4,
        clarity: 4,
        focus: 4,
      });
    });

    it('approve() still succeeds even if search indexing fails', async () => {
      mockPendingRoundRatingEntry();
      reviewSearchService.indexReview.mockRejectedValue(new Error('OpenSearch unreachable'));

      await expect(service.approve('queue-1', {})).resolves.toBeDefined();
    });

    it('reject() flips the round rating to rejected and does not index it', async () => {
      mockPendingRoundRatingEntry();

      await service.reject('queue-1', {});

      expect(prisma.roundRating.update).toHaveBeenCalledWith({
        where: { id: 'rating-1' },
        data: { status: 'rejected' },
      });
      expect(reviewSearchService.indexReview).not.toHaveBeenCalled();
    });

    it('flag() flips the round rating to flagged, records the flag reason, and does not index it', async () => {
      mockPendingRoundRatingEntry();

      await service.flag('queue-1', { flagReason: 'spam_pattern' });

      expect(prisma.roundRating.update).toHaveBeenCalledWith({
        where: { id: 'rating-1' },
        data: { status: 'flagged' },
      });
      expect(prisma.moderationQueueEntry.updateMany).toHaveBeenCalledWith({
        where: { id: 'queue-1', reviewedAt: null },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any() is typed `any` by @types/jest
        data: { reviewedAt: expect.any(Date), reviewedBy: undefined, flagReason: 'spam_pattern' },
      });
      expect(reviewSearchService.indexReview).not.toHaveBeenCalled();
    });

    it('throws a conflict if the entry was already reviewed', async () => {
      prisma.moderationQueueEntry.findUniqueOrThrow.mockResolvedValue({
        id: 'queue-1',
        entityType: 'round_rating',
        entityId: 'rating-1',
        reviewedAt: new Date(),
      });

      await expect(service.approve('queue-1', {})).rejects.toThrow(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    // GitHub issue #674 (Phase 47, D104) — the TOCTOU race this phase
    // fixes: this call's own initial findUniqueOrThrow read reviewedAt:
    // null (nothing else had committed yet), but by the time its own
    // transaction reaches the atomic updateMany, another caller already
    // has. Before the fix, review() used a plain `update({ where: { id } })`
    // here — unconditional on reviewedAt — so this call would have
    // succeeded anyway, flipping the entity's status a second time.
    it('treats updateMany matching zero rows as a lost race and throws a conflict, even though the initial read saw reviewedAt: null', async () => {
      prisma.moderationQueueEntry.findUniqueOrThrow.mockResolvedValue({
        id: 'queue-1',
        entityType: 'round_rating',
        entityId: 'rating-1',
        reviewedAt: null,
        flagReason: null,
      });
      prisma.roundRating.findUnique.mockResolvedValue({ id: 'rating-1' });
      prisma.moderationQueueEntry.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.approve('queue-1', { reviewedBy: 'moderator-a' })).rejects.toThrow(ConflictException);

      expect(prisma.roundRating.update).not.toHaveBeenCalled();
    });

    // Same fix, exercised end to end: two moderators (or a moderator
    // racing the AI auto-approval path, GitHub issue #440) both calling
    // approve() on the same entry concurrently. mockPendingRoundRatingEntry()
    // uses mockPendingQueueEntry()'s stateful updateMany, which only
    // reports count: 1 while reviewedAt is still null — so exactly one of
    // the two calls here must win, never both and never neither.
    it('lets only one of two concurrent approve() calls on the same entry succeed', async () => {
      mockPendingRoundRatingEntry();

      const results = await Promise.allSettled([
        service.approve('queue-1', { reviewedBy: 'moderator-a' }),
        service.approve('queue-1', { reviewedBy: 'moderator-b' }),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(ConflictException);
      expect(prisma.roundRating.update).toHaveBeenCalledTimes(1);
    });

    function mockPendingRecruiterRatingEntry() {
      mockPendingQueueEntry(prisma, { id: 'queue-2', entityType: 'recruiter_rating', entityId: 'rating-2' });
      prisma.recruiterRating.update.mockResolvedValue({ id: 'rating-2', status: 'approved' });
      prisma.recruiterRating.findUniqueOrThrow.mockResolvedValue({
        id: 'rating-2',
        recruiterInteractionId: 'interaction-1',
        candidateId: 'candidate-2',
        recruiterInteraction: { process: { companyId: 'company-2' } },
      });
    }

    it('approve() flips a recruiter rating to approved and does not attempt search indexing', async () => {
      mockPendingRecruiterRatingEntry();

      await service.approve('queue-2', { reviewedBy: 'gowtham' });

      expect(prisma.recruiterRating.update).toHaveBeenCalledWith({
        where: { id: 'rating-2' },
        data: { status: 'approved' },
      });
      expect(reviewSearchService.indexReview).not.toHaveBeenCalled();
    });

    it('reject() flips a recruiter rating to rejected', async () => {
      mockPendingRecruiterRatingEntry();

      await service.reject('queue-2', {});

      expect(prisma.recruiterRating.update).toHaveBeenCalledWith({
        where: { id: 'rating-2' },
        data: { status: 'rejected' },
      });
    });

    function mockPendingOverallReviewEntry() {
      mockPendingQueueEntry(prisma, { id: 'queue-3', entityType: 'overall_review', entityId: 'review-1' });
      prisma.overallReview.update.mockResolvedValue({ id: 'review-1', status: 'approved' });
      prisma.overallReview.findUniqueOrThrow.mockResolvedValue({
        id: 'review-1',
        processId: 'process-1',
        candidateId: 'candidate-3',
        process: { companyId: 'company-3' },
      });
    }

    it('approve() flips an overall review to approved and does not attempt search indexing', async () => {
      mockPendingOverallReviewEntry();

      await service.approve('queue-3', { reviewedBy: 'gowtham' });

      expect(prisma.overallReview.update).toHaveBeenCalledWith({
        where: { id: 'review-1' },
        data: { status: 'approved' },
      });
      expect(reviewSearchService.indexReview).not.toHaveBeenCalled();
    });

    it('reject() flips an overall review to rejected', async () => {
      mockPendingOverallReviewEntry();

      await service.reject('queue-3', {});

      expect(prisma.overallReview.update).toHaveBeenCalledWith({
        where: { id: 'review-1' },
        data: { status: 'rejected' },
      });
    });

    function mockPendingCompanyEntry() {
      mockPendingQueueEntry(prisma, { id: 'queue-4', entityType: 'company', entityId: 'company-1' });
      prisma.company.update.mockResolvedValue({ id: 'company-1', status: 'approved' });
      prisma.company.findUniqueOrThrow.mockResolvedValue({
        id: 'company-1',
        name: 'Acme Corp',
        slug: 'acme-corp',
        industry: null,
        sizeBucket: 'mid',
      });
    }

    // GitHub issue #369 (Phase 35) — approving a company creation request
    // moves D16's indexing trigger from creation-time to approval-time.
    it('approve() flips a company to approved and indexes it into OpenSearch', async () => {
      mockPendingCompanyEntry();

      await service.approve('queue-4', { reviewedBy: 'gowtham' });

      expect(prisma.company.update).toHaveBeenCalledWith({
        where: { id: 'company-1' },
        data: { status: 'approved' },
      });
      expect(companySearchService.indexCompany).toHaveBeenCalledWith({
        id: 'company-1',
        name: 'Acme Corp',
        slug: 'acme-corp',
        industry: null,
        sizeBucket: 'mid',
      });
    });

    it('approve() on a company still succeeds even if search indexing fails', async () => {
      mockPendingCompanyEntry();
      companySearchService.indexCompany.mockRejectedValue(new Error('OpenSearch unreachable'));

      await expect(service.approve('queue-4', {})).resolves.toBeDefined();
    });

    it('reject() flips a company to rejected and never indexes it', async () => {
      mockPendingCompanyEntry();

      await service.reject('queue-4', {});

      expect(prisma.company.update).toHaveBeenCalledWith({
        where: { id: 'company-1' },
        data: { status: 'rejected' },
      });
      expect(companySearchService.indexCompany).not.toHaveBeenCalled();
    });

    // GitHub issue #370 (Phase 35) — any resolution removes the entry
    // from the moderator search index, since it's no longer part of the
    // *pending* universe that index covers.
    it('approve() removes the entry from the moderator search index', async () => {
      mockPendingRoundRatingEntry();

      await service.approve('queue-1', {});

      expect(moderationQueueSearchService.removeEntry).toHaveBeenCalledWith('round_rating', 'rating-1');
    });

    it('reject() removes the entry from the moderator search index', async () => {
      mockPendingRoundRatingEntry();

      await service.reject('queue-1', {});

      expect(moderationQueueSearchService.removeEntry).toHaveBeenCalledWith('round_rating', 'rating-1');
    });

    it('flag() removes the entry from the moderator search index', async () => {
      mockPendingRoundRatingEntry();

      await service.flag('queue-1', { flagReason: 'spam_pattern' });

      expect(moderationQueueSearchService.removeEntry).toHaveBeenCalledWith('round_rating', 'rating-1');
    });

    it('reject() on a company removes it from the moderator search index too', async () => {
      mockPendingCompanyEntry();

      await service.reject('queue-4', {});

      expect(moderationQueueSearchService.removeEntry).toHaveBeenCalledWith('company', 'company-1');
    });

    // GitHub issue #383 / docs/DECISIONS.md D61: a raw-SQL deletion of the
    // underlying entity, bypassing removeQueueEntries(), can leave a queue
    // entry with nothing left to review — closing the narrow race where a
    // moderator's page was already open when this happened (the more
    // common case, listPending()/search() self-healing on the next read,
    // is covered above).
    it('approve() on an orphaned entry (underlying record already gone) removes the stale queue entry and throws not-found, not a raw Prisma error', async () => {
      mockPendingRoundRatingEntry();
      prisma.roundRating.findUnique.mockResolvedValue(null);
      prisma.moderationQueueEntry.delete.mockResolvedValue({ id: 'queue-1' });

      await expect(service.approve('queue-1', {})).rejects.toThrow(NotFoundException);

      expect(prisma.moderationQueueEntry.delete).toHaveBeenCalledWith({ where: { id: 'queue-1' } });
      expect(moderationQueueSearchService.removeEntry).toHaveBeenCalledWith('round_rating', 'rating-1');
      expect(prisma.roundRating.update).not.toHaveBeenCalled();
      expect(prisma.moderationQueueEntry.updateMany).not.toHaveBeenCalled();
    });

    // GitHub issue #332 (Phase 30, D53) — best-effort domain event
    // published after every decision commits, one per entity type.
    it('approve() publishes a round_rating status_changed event', async () => {
      mockPendingRoundRatingEntry();

      await service.approve('queue-1', { reviewedBy: 'gowtham' });

      expect(domainEventPublisher.publish).toHaveBeenCalledWith(
        'moderation.round_rating.status_changed.v1',
        expect.objectContaining({
          eventType: 'moderation.round_rating.status_changed',
          eventVersion: 1,
          roundRatingId: 'rating-1',
          roundId: 'round-1',
          candidateId: 'candidate-1',
          companyId: 'company-1',
          previousStatus: 'pending',
          newStatus: 'approved',
          reviewedBy: 'gowtham',
          // GitHub issue #686 (Phase 49, D104) — carries the queue entry
          // that this specific decision was made on, so a later edit's
          // fresh queue entry (reenqueue()) doesn't get confused with
          // this one downstream (#687's idempotency key fix).
          moderationQueueEntryId: 'queue-1',
        }),
        'rating-1',
      );
    });

    it('reject() publishes a recruiter_rating status_changed event', async () => {
      mockPendingRecruiterRatingEntry();

      await service.reject('queue-2', {});

      expect(domainEventPublisher.publish).toHaveBeenCalledWith(
        'moderation.recruiter_rating.status_changed.v1',
        expect.objectContaining({
          eventType: 'moderation.recruiter_rating.status_changed',
          recruiterRatingId: 'rating-2',
          recruiterInteractionId: 'interaction-1',
          candidateId: 'candidate-2',
          companyId: 'company-2',
          previousStatus: 'pending',
          newStatus: 'rejected',
        }),
        'rating-2',
      );
    });

    it('flag() publishes an overall_review status_changed event', async () => {
      mockPendingOverallReviewEntry();
      prisma.moderationQueueEntry.findUniqueOrThrow.mockResolvedValue({
        id: 'queue-3',
        entityType: 'overall_review',
        entityId: 'review-1',
        reviewedAt: null,
        flagReason: null,
      });

      await service.flag('queue-3', { flagReason: 'spam_pattern' });

      expect(domainEventPublisher.publish).toHaveBeenCalledWith(
        'moderation.overall_review.status_changed.v1',
        expect.objectContaining({
          eventType: 'moderation.overall_review.status_changed',
          overallReviewId: 'review-1',
          processId: 'process-1',
          candidateId: 'candidate-3',
          companyId: 'company-3',
          previousStatus: 'pending',
          newStatus: 'flagged',
        }),
        'review-1',
      );
    });

    it('never publishes a status_changed event for a company decision (out of scope for #332)', async () => {
      mockPendingCompanyEntry();

      await service.approve('queue-4', {});

      expect(domainEventPublisher.publish).not.toHaveBeenCalled();
    });

    // D16/D17-style adversarial proof: a broker outage never affects the
    // moderation decision itself, which is already committed by the time
    // this best-effort publish runs.
    it('approve() still succeeds even if the domain event publish rejects', async () => {
      mockPendingRoundRatingEntry();
      domainEventPublisher.publish.mockRejectedValue(new Error('Redpanda unreachable'));

      await expect(service.approve('queue-1', {})).resolves.toBeDefined();
    });
  });

  // GitHub issue #487 (Phase 36, D80) — manual claim/release.
  describe('claim / release', () => {
    // GitHub issue #675 (Phase 47, D104) — claim()/release() now do a
    // fast-path findUniqueOrThrow read, an atomic updateMany gated on the
    // exact condition that read checked, and (only on success) a final
    // findUniqueOrThrow to fetch the joined moderator. This mock tracks
    // live state so updateMany's WHERE clause can be evaluated against
    // it, same shape as mockPendingQueueEntry() above but keyed on
    // claimedById rather than reviewedAt.
    function mockLiveQueueEntry(initial: { id: string; reviewedAt: Date | null; claimedById: string | null }) {
      const state: Record<string, unknown> = { ...initial };
      prisma.moderationQueueEntry.findUniqueOrThrow.mockImplementation(() => {
        const claimedById = state.claimedById as string | null;
        const claimedBy = claimedById ? { id: claimedById, username: `${claimedById}-name` } : null;
        return Promise.resolve({ ...state, claimedBy });
      });
      prisma.moderationQueueEntry.updateMany.mockImplementation((args: { where: Record<string, unknown>; data: object }) => {
        const matches = Object.entries(args.where).every(([key, value]) => key === 'id' || state[key] === value);
        if (!matches) return Promise.resolve({ count: 0 });
        Object.assign(state, args.data);
        return Promise.resolve({ count: 1 });
      });
      return state;
    }

    it('claim() sets claimedById/claimedAt and returns the joined moderator', async () => {
      mockLiveQueueEntry({ id: 'queue-1', reviewedAt: null, claimedById: null });

      const result = await service.claim('queue-1', 'mod-1');

      expect(prisma.moderationQueueEntry.updateMany).toHaveBeenCalledWith({
        where: { id: 'queue-1', reviewedAt: null, claimedById: null },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any() is typed `any` by @types/jest
        data: { claimedById: 'mod-1', claimedAt: expect.any(Date) },
      });
      expect(result).toMatchObject({ claimedBy: { id: 'mod-1' } });
    });

    it('claim() rejects claiming an already-claimed entry', async () => {
      mockLiveQueueEntry({ id: 'queue-1', reviewedAt: null, claimedById: 'mod-2' });

      await expect(service.claim('queue-1', 'mod-1')).rejects.toThrow(ConflictException);
      expect(prisma.moderationQueueEntry.updateMany).not.toHaveBeenCalled();
    });

    it('claim() rejects claiming an already-reviewed entry', async () => {
      mockLiveQueueEntry({ id: 'queue-1', reviewedAt: new Date(), claimedById: null });

      await expect(service.claim('queue-1', 'mod-1')).rejects.toThrow(ConflictException);
      expect(prisma.moderationQueueEntry.updateMany).not.toHaveBeenCalled();
    });

    it('claim() treats updateMany matching zero rows as a lost race and throws a conflict, even though the initial read saw claimedById: null', async () => {
      prisma.moderationQueueEntry.findUniqueOrThrow.mockResolvedValueOnce({
        id: 'queue-1',
        reviewedAt: null,
        claimedById: null,
      });
      prisma.moderationQueueEntry.updateMany.mockResolvedValue({ count: 0 });
      // Re-fetch on the lost-race path reports the entry as claimed by
      // whoever won.
      prisma.moderationQueueEntry.findUniqueOrThrow.mockResolvedValueOnce({
        id: 'queue-1',
        reviewedAt: null,
        claimedById: 'mod-2',
      });

      await expect(service.claim('queue-1', 'mod-1')).rejects.toThrow(ConflictException);
    });

    it('lets only one of two concurrent claim() calls on the same entry succeed', async () => {
      mockLiveQueueEntry({ id: 'queue-1', reviewedAt: null, claimedById: null });

      const results = await Promise.allSettled([service.claim('queue-1', 'mod-1'), service.claim('queue-1', 'mod-2')]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(ConflictException);
    });

    it('release() clears claimedById/claimedAt for the moderator holding the claim', async () => {
      mockLiveQueueEntry({ id: 'queue-1', reviewedAt: null, claimedById: 'mod-1' });

      const result = await service.release('queue-1', 'mod-1');

      expect(prisma.moderationQueueEntry.updateMany).toHaveBeenCalledWith({
        where: { id: 'queue-1', claimedById: 'mod-1' },
        data: { claimedById: null, claimedAt: null },
      });
      expect(result).toMatchObject({ claimedBy: null });
    });

    it('release() rejects when the entry is not currently claimed', async () => {
      mockLiveQueueEntry({ id: 'queue-1', reviewedAt: null, claimedById: null });

      await expect(service.release('queue-1', 'mod-1')).rejects.toThrow(ConflictException);
      expect(prisma.moderationQueueEntry.updateMany).not.toHaveBeenCalled();
    });

    it("release() forbids releasing another moderator's claim", async () => {
      mockLiveQueueEntry({ id: 'queue-1', reviewedAt: null, claimedById: 'mod-2' });

      await expect(service.release('queue-1', 'mod-1')).rejects.toThrow(ForbiddenException);
      expect(prisma.moderationQueueEntry.updateMany).not.toHaveBeenCalled();
    });

    it('release() treats updateMany matching zero rows as a lost race and throws a conflict, even though the initial read saw the caller holding the claim', async () => {
      prisma.moderationQueueEntry.findUniqueOrThrow.mockResolvedValueOnce({
        id: 'queue-1',
        reviewedAt: null,
        claimedById: 'mod-1',
      });
      prisma.moderationQueueEntry.updateMany.mockResolvedValue({ count: 0 });
      // Re-fetch on the lost-race path reports it as no longer claimed at
      // all (the other branch this same guard covers — releasing a claim
      // someone else now holds — is exercised by the concurrent test
      // below instead).
      prisma.moderationQueueEntry.findUniqueOrThrow.mockResolvedValueOnce({
        id: 'queue-1',
        reviewedAt: null,
        claimedById: null,
      });

      await expect(service.release('queue-1', 'mod-1')).rejects.toThrow(ConflictException);
    });

    it('a second concurrent release() of the same claim correctly reports "not currently claimed" instead of silently re-succeeding', async () => {
      mockLiveQueueEntry({ id: 'queue-1', reviewedAt: null, claimedById: 'mod-1' });

      const results = await Promise.allSettled([service.release('queue-1', 'mod-1'), service.release('queue-1', 'mod-1')]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(ConflictException);
    });
  });

  // GitHub issue #440 (Phase 39, D71) — the system-attributed auto-approval
  // entry point the verdict-consumer (GitHub issue #340, D81) calls. Reuses
  // the exact same review()
  // path approve() does (mockPendingRoundRatingEntry() below is the same
  // helper the human-moderator approve() tests above use), with the one
  // addition that a durable audit row is written in the same transaction.
  describe('approveWithAudit', () => {
    function mockPendingRoundRatingEntry() {
      mockPendingQueueEntry(prisma, { id: 'queue-1', entityType: 'round_rating', entityId: 'rating-1' });
      prisma.roundRating.update.mockResolvedValue({ id: 'rating-1', status: 'approved' });
      prisma.roundRating.findUniqueOrThrow.mockResolvedValue({
        id: 'rating-1',
        freeText: 'Great round',
        createdAt: new Date('2026-01-01'),
        difficulty: 3,
        fluency: 4,
        clarity: 4,
        focus: 4,
        round: {
          roundType: 'coding',
          process: { companyId: 'company-1', roleTitle: 'Engineer' },
        },
      });
    }

    const auditInput = {
      entityType: 'round_rating' as const,
      entityId: 'rating-1',
      promptContent: 'Content type: interview round rating\n...',
      responseText: '{"concerning":false,"reasons":[],"summary":"Fine.","confidence":0.92}',
      verdict: { concerning: false, reasons: [], summary: 'Fine.', confidence: 0.92 },
      confidence: 0.92,
      model: 'claude-haiku-4-5',
    };

    it('approves the queue entry exactly like approve() does', async () => {
      mockPendingRoundRatingEntry();

      await service.approveWithAudit('queue-1', { reviewedBy: 'system:ai-auto-approval' }, auditInput);

      expect(prisma.roundRating.update).toHaveBeenCalledWith({
        where: { id: 'rating-1' },
        data: { status: 'approved' },
      });
      expect(prisma.moderationQueueEntry.updateMany).toHaveBeenCalledWith({
        where: { id: 'queue-1', reviewedAt: null },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any() is typed `any` by @types/jest
        data: { reviewedAt: expect.any(Date), reviewedBy: 'system:ai-auto-approval', flagReason: undefined },
      });
    });

    it('writes the audit row inside the same transaction as the approval', async () => {
      mockPendingRoundRatingEntry();

      await service.approveWithAudit('queue-1', { reviewedBy: 'system:ai-auto-approval' }, auditInput);

      expect(prisma.aiAutoApprovalAudit.create).toHaveBeenCalledWith({
        data: {
          entityType: 'round_rating',
          entityId: 'rating-1',
          moderationQueueEntryId: 'queue-1',
          promptContent: auditInput.promptContent,
          responseText: auditInput.responseText,
          verdict: auditInput.verdict,
          confidence: 0.92,
          model: 'claude-haiku-4-5',
        },
      });
      // Both writes went through the same $transaction callback — the
      // clearest available signal, given the test's $transaction mock
      // invokes its callback with `prisma` itself, that they share one
      // atomic unit rather than being two independent calls.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('never writes the audit row when the queue entry was already reviewed', async () => {
      prisma.moderationQueueEntry.findUniqueOrThrow.mockResolvedValue({
        id: 'queue-1',
        entityType: 'round_rating',
        entityId: 'rating-1',
        reviewedAt: new Date('2026-01-01'),
        flagReason: null,
      });

      await expect(
        service.approveWithAudit('queue-1', { reviewedBy: 'system:ai-auto-approval' }, auditInput),
      ).rejects.toThrow(ConflictException);

      expect(prisma.aiAutoApprovalAudit.create).not.toHaveBeenCalled();
    });

    it('never writes the audit row when the underlying entity no longer exists', async () => {
      mockPendingRoundRatingEntry();
      prisma.roundRating.findUnique.mockResolvedValue(null);
      prisma.moderationQueueEntry.delete.mockResolvedValue({ id: 'queue-1' });

      await expect(
        service.approveWithAudit('queue-1', { reviewedBy: 'system:ai-auto-approval' }, auditInput),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.aiAutoApprovalAudit.create).not.toHaveBeenCalled();
    });
  });

  // GitHub issue #332 (Phase 30, D53) — called by every write-path
  // service's create() right after its own transaction commits, same
  // shape as indexForSearch below.
  describe('publishCreatedEvent', () => {
    it('publishes a round_rating created event', async () => {
      prisma.roundRating.findUniqueOrThrow.mockResolvedValue({
        id: 'rating-1',
        roundId: 'round-1',
        candidateId: 'candidate-1',
        round: { process: { companyId: 'company-1' } },
      });

      await service.publishCreatedEvent('round_rating', 'rating-1');

      expect(domainEventPublisher.publish).toHaveBeenCalledWith(
        'moderation.round_rating.created.v1',
        expect.objectContaining({
          eventType: 'moderation.round_rating.created',
          eventVersion: 1,
          roundRatingId: 'rating-1',
          roundId: 'round-1',
          candidateId: 'candidate-1',
          companyId: 'company-1',
          status: 'pending',
        }),
        'rating-1',
      );
    });

    it('publishes a recruiter_rating created event', async () => {
      prisma.recruiterRating.findUniqueOrThrow.mockResolvedValue({
        id: 'rating-2',
        recruiterInteractionId: 'interaction-1',
        candidateId: 'candidate-2',
        recruiterInteraction: { process: { companyId: 'company-2' } },
      });

      await service.publishCreatedEvent('recruiter_rating', 'rating-2');

      expect(domainEventPublisher.publish).toHaveBeenCalledWith(
        'moderation.recruiter_rating.created.v1',
        expect.objectContaining({
          eventType: 'moderation.recruiter_rating.created',
          recruiterRatingId: 'rating-2',
          recruiterInteractionId: 'interaction-1',
          candidateId: 'candidate-2',
          companyId: 'company-2',
          status: 'pending',
        }),
        'rating-2',
      );
    });

    it('publishes an overall_review created event', async () => {
      prisma.overallReview.findUniqueOrThrow.mockResolvedValue({
        id: 'review-1',
        processId: 'process-1',
        candidateId: 'candidate-3',
        process: { companyId: 'company-3' },
      });

      await service.publishCreatedEvent('overall_review', 'review-1');

      expect(domainEventPublisher.publish).toHaveBeenCalledWith(
        'moderation.overall_review.created.v1',
        expect.objectContaining({
          eventType: 'moderation.overall_review.created',
          overallReviewId: 'review-1',
          processId: 'process-1',
          candidateId: 'candidate-3',
          companyId: 'company-3',
          status: 'pending',
        }),
        'review-1',
      );
    });

    it('never publishes a created event for a company request (out of scope for #332)', async () => {
      await service.publishCreatedEvent('company', 'company-1');

      expect(domainEventPublisher.publish).not.toHaveBeenCalled();
    });

    // D16/D17-style adversarial proof — the caller (RoundRatingsService
    // etc.) awaits this method directly, so it must never throw back.
    it('never throws when the publish itself rejects', async () => {
      prisma.roundRating.findUniqueOrThrow.mockResolvedValue({
        id: 'rating-1',
        roundId: 'round-1',
        candidateId: 'candidate-1',
        round: { process: { companyId: 'company-1' } },
      });
      domainEventPublisher.publish.mockRejectedValue(new Error('Redpanda unreachable'));

      await expect(service.publishCreatedEvent('round_rating', 'rating-1')).resolves.toBeUndefined();
    });

    it('never throws when the underlying entity fetch fails', async () => {
      prisma.roundRating.findUniqueOrThrow.mockRejectedValue(new Error('Record not found'));

      await expect(service.publishCreatedEvent('round_rating', 'rating-1')).resolves.toBeUndefined();
      expect(domainEventPublisher.publish).not.toHaveBeenCalled();
    });
  });

  // GitHub issue #370 (Phase 35) — indexing happens after the caller's own
  // transaction has committed, so ModerationService re-derives the
  // display fields fresh from Postgres rather than trusting anything the
  // caller might already have in scope.
  describe('indexForSearch', () => {
    it('indexes a round_rating as category interview-review', async () => {
      prisma.roundRating.findUnique.mockResolvedValue({
        id: 'rating-1',
        freeText: 'Great round',
        createdAt: new Date('2026-01-01'),
        round: { process: { roleTitle: 'Engineer', company: { name: 'Acme' } } },
      });

      await service.indexForSearch('round_rating', 'rating-1');

      expect(moderationQueueSearchService.indexEntry).toHaveBeenCalledWith({
        entityType: 'round_rating',
        entityId: 'rating-1',
        category: 'interview-review',
        companyName: 'Acme',
        roleTitle: 'Engineer',
        freeTextPreview: 'Great round',
        createdAt: new Date('2026-01-01'),
      });
    });

    it('indexes a recruiter_rating as category interview-review', async () => {
      prisma.recruiterRating.findUnique.mockResolvedValue({
        id: 'rating-2',
        freeText: null,
        createdAt: new Date('2026-01-02'),
        recruiterInteraction: { process: { roleTitle: 'Manager', company: { name: 'Globex' } } },
      });

      await service.indexForSearch('recruiter_rating', 'rating-2');

      expect(moderationQueueSearchService.indexEntry).toHaveBeenCalledWith({
        entityType: 'recruiter_rating',
        entityId: 'rating-2',
        category: 'interview-review',
        companyName: 'Globex',
        roleTitle: 'Manager',
        freeTextPreview: null,
        createdAt: new Date('2026-01-02'),
      });
    });

    it('indexes an overall_review as category interview-review', async () => {
      prisma.overallReview.findUnique.mockResolvedValue({
        id: 'review-1',
        reviewText: 'Loved it',
        createdAt: new Date('2026-01-03'),
        process: { roleTitle: 'Staff Engineer', company: { name: 'Initech' } },
      });

      await service.indexForSearch('overall_review', 'review-1');

      expect(moderationQueueSearchService.indexEntry).toHaveBeenCalledWith({
        entityType: 'overall_review',
        entityId: 'review-1',
        category: 'interview-review',
        companyName: 'Initech',
        roleTitle: 'Staff Engineer',
        freeTextPreview: 'Loved it',
        createdAt: new Date('2026-01-03'),
      });
    });

    it('indexes a company as category create-company, with no roleTitle/freeTextPreview', async () => {
      prisma.company.findUnique.mockResolvedValue({
        id: 'company-1',
        name: 'Acme Corp',
        createdAt: new Date('2026-01-04'),
      });

      await service.indexForSearch('company', 'company-1');

      expect(moderationQueueSearchService.indexEntry).toHaveBeenCalledWith({
        entityType: 'company',
        entityId: 'company-1',
        category: 'create-company',
        companyName: 'Acme Corp',
        roleTitle: null,
        freeTextPreview: null,
        createdAt: new Date('2026-01-04'),
      });
    });

    it('does nothing when the entity no longer exists (a fast create-then-delete race)', async () => {
      prisma.roundRating.findUnique.mockResolvedValue(null);

      await service.indexForSearch('round_rating', 'gone');

      expect(moderationQueueSearchService.indexEntry).not.toHaveBeenCalled();
    });

    it('never throws when indexing fails', async () => {
      prisma.roundRating.findUnique.mockResolvedValue({
        id: 'rating-1',
        freeText: null,
        createdAt: new Date('2026-01-01'),
        round: { process: { roleTitle: 'Engineer', company: { name: 'Acme' } } },
      });
      moderationQueueSearchService.indexEntry.mockRejectedValue(new Error('OpenSearch unreachable'));

      await expect(service.indexForSearch('round_rating', 'rating-1')).resolves.toBeUndefined();
    });
  });

  describe('removeFromSearchIndex', () => {
    it('delegates to ModerationQueueSearchService.removeEntry', async () => {
      await service.removeFromSearchIndex('round_rating', 'rating-1');

      expect(moderationQueueSearchService.removeEntry).toHaveBeenCalledWith('round_rating', 'rating-1');
    });
  });

  describe('search', () => {
    it('returns an empty array without querying Postgres when there are no search hits', async () => {
      moderationQueueSearchService.search.mockResolvedValue([]);

      const result = await service.search('acme', undefined);

      expect(result).toEqual([]);
      expect(prisma.moderationQueueEntry.findMany).not.toHaveBeenCalled();
    });

    it('passes q and category through to the search index, and enriches matching pending entries in relevance order', async () => {
      moderationQueueSearchService.search.mockResolvedValue([
        { entityType: 'overall_review', entityId: 'ov1' },
        { entityType: 'round_rating', entityId: 'rr1' },
      ]);
      prisma.moderationQueueEntry.findMany.mockResolvedValue([
        { id: 'q1', entityType: 'round_rating', entityId: 'rr1', reviewedAt: null },
        { id: 'q2', entityType: 'overall_review', entityId: 'ov1', reviewedAt: null },
      ]);
      prisma.roundRating.findMany.mockResolvedValue([
        {
          id: 'rr1',
          difficulty: 3,
          fluency: 4,
          clarity: 4,
          focus: 4,
          technicalDepth: null,
          freeText: null,
          round: {
            title: 'Screen',
            roundType: 'coding',
            description: null,
            typeMetadata: null,
            scheduledDurationMinutes: null,
            process: { id: 'process-1', roleTitle: 'Engineer', company: { name: 'Acme' } },
          },
        },
      ]);
      prisma.overallReview.findMany.mockResolvedValue([
        {
          id: 'ov1',
          overallExperience: 4,
          wouldRecommend: true,
          reviewText: 'good loop',
          process: { id: 'process-2', roleTitle: 'Manager', company: { name: 'Acme' } },
        },
      ]);

      const result = await service.search('acme', 'interview-review');

      expect(moderationQueueSearchService.search).toHaveBeenCalledWith('acme', 'interview-review');
      // Relevance order from the search hits (overall_review first, then
      // round_rating) is preserved, not the grouped/createdAt order
      // listPending() would use.
      expect(result.map((e) => e.entityId)).toEqual(['ov1', 'rr1']);
    });

    it('silently drops a hit whose queue entry was resolved between the search and the enrichment lookup', async () => {
      moderationQueueSearchService.search.mockResolvedValue([
        { entityType: 'round_rating', entityId: 'rr1' },
      ]);
      // Simulates the race: the entry no longer matches reviewedAt: null
      // by the time this query runs, so findMany returns nothing for it.
      prisma.moderationQueueEntry.findMany.mockResolvedValue([]);

      const result = await service.search('acme', undefined);

      expect(result).toEqual([]);
    });
  });
});
