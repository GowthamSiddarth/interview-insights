import { Test, TestingModule } from '@nestjs/testing';
import { EditThrottleService } from './edit-throttle.service';
import { PrismaService } from '../prisma/prisma.service';

describe('EditThrottleService', () => {
  let service: EditThrottleService;
  let prisma: {
    editThrottleState: { updateMany: jest.Mock; findUnique: jest.Mock; upsert: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      editThrottleState: {
        updateMany: jest.fn(),
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [EditThrottleService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(EditThrottleService);
  });

  it('allows the first attempt for a candidate (no existing row, starts a fresh window)', async () => {
    prisma.editThrottleState.updateMany.mockResolvedValue({ count: 0 });
    prisma.editThrottleState.findUnique.mockResolvedValue(null);
    prisma.editThrottleState.upsert.mockResolvedValue({});

    const allowed = await service.recordAttemptIfAllowed('candidate-1');

    expect(allowed).toBe(true);
    expect(prisma.editThrottleState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { candidateId: 'candidate-1' },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining() is typed `any` by @types/jest
        create: expect.objectContaining({ candidateId: 'candidate-1', count: 1 }),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining() is typed `any` by @types/jest
        update: expect.objectContaining({ count: 1 }),
      }),
    );
  });

  it('bumps an existing under-cap window atomically, without a fresh-window upsert', async () => {
    prisma.editThrottleState.updateMany.mockResolvedValue({ count: 1 });

    const allowed = await service.recordAttemptIfAllowed('candidate-1');

    expect(allowed).toBe(true);
    expect(prisma.editThrottleState.updateMany).toHaveBeenCalledWith({
      where: {
        candidateId: 'candidate-1',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any() is typed `any` by @types/jest
        windowStart: { gte: expect.any(Date) },
        count: { lt: 5 },
      },
      data: { count: { increment: 1 } },
    });
    expect(prisma.editThrottleState.findUnique).not.toHaveBeenCalled();
    expect(prisma.editThrottleState.upsert).not.toHaveBeenCalled();
  });

  it('is blocked once the cap is reached within a still-current window', async () => {
    prisma.editThrottleState.updateMany.mockResolvedValue({ count: 0 });
    prisma.editThrottleState.findUnique.mockResolvedValue({
      candidateId: 'candidate-1',
      windowStart: new Date(),
      count: 5,
    });

    const allowed = await service.recordAttemptIfAllowed('candidate-1');

    expect(allowed).toBe(false);
    expect(prisma.editThrottleState.upsert).not.toHaveBeenCalled();
  });

  it('starts a fresh window (and allows the attempt) once the existing window has expired', async () => {
    prisma.editThrottleState.updateMany.mockResolvedValue({ count: 0 });
    prisma.editThrottleState.findUnique.mockResolvedValue({
      candidateId: 'candidate-1',
      windowStart: new Date(Date.now() - 61 * 60 * 1000), // past the 60-minute window
      count: 5,
    });
    prisma.editThrottleState.upsert.mockResolvedValue({});

    const allowed = await service.recordAttemptIfAllowed('candidate-1');

    expect(allowed).toBe(true);
    expect(prisma.editThrottleState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining() is typed `any` by @types/jest
        update: expect.objectContaining({ count: 1 }),
      }),
    );
  });
});
