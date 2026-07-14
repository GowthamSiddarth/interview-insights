import { Test, TestingModule } from '@nestjs/testing';
import { CandidatesService } from './candidates.service';
import { PrismaService } from '../prisma/prisma.service';

describe('CandidatesService', () => {
  let service: CandidatesService;
  let prisma: { candidate: { upsert: jest.Mock; findUniqueOrThrow: jest.Mock } };
  const originalSecret = process.env.EMAIL_HASH_SECRET;

  beforeEach(async () => {
    process.env.EMAIL_HASH_SECRET = 'test-secret';
    prisma = {
      candidate: {
        upsert: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [CandidatesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(CandidatesService);
  });

  afterEach(() => {
    process.env.EMAIL_HASH_SECRET = originalSecret;
  });

  it('upserts on the hashed email, never the raw email', async () => {
    let capturedArgs: { where: { emailHash: string }; create: { emailHash: string } } | undefined;
    prisma.candidate.upsert.mockImplementation((args: typeof capturedArgs) => {
      capturedArgs = args;
      return Promise.resolve({
        id: 'candidate-1',
        emailHash: 'irrelevant-here',
        verificationStatus: 'unverified',
        verifiedAt: null,
        createdAt: new Date('2026-01-01'),
      });
    });

    await service.create({ email: 'Candidate@Example.com' });

    expect(capturedArgs?.where.emailHash).toBeDefined();
    expect(capturedArgs?.where.emailHash).not.toContain('candidate');
    expect(capturedArgs?.create.emailHash).toBe(capturedArgs?.where.emailHash);
  });

  it('never returns emailHash from create()', async () => {
    prisma.candidate.upsert.mockResolvedValue({
      id: 'candidate-1',
      emailHash: 'super-secret-hash',
      verificationStatus: 'unverified',
      verifiedAt: null,
      createdAt: new Date('2026-01-01'),
    });

    const result = await service.create({ email: 'candidate@example.com' });

    expect(result).not.toHaveProperty('emailHash');
    expect(result).toEqual({
      id: 'candidate-1',
      verificationStatus: 'unverified',
      verifiedAt: null,
      createdAt: new Date('2026-01-01'),
    });
  });

  it('throws if EMAIL_HASH_SECRET is not configured', async () => {
    delete process.env.EMAIL_HASH_SECRET;

    await expect(service.create({ email: 'candidate@example.com' })).rejects.toThrow(
      'EMAIL_HASH_SECRET',
    );
  });
});
