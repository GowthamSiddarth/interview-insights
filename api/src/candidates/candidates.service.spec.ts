import { Test, TestingModule } from '@nestjs/testing';
import { CandidatesService } from './candidates.service';
import { PrismaService } from '../prisma/prisma.service';

describe('CandidatesService', () => {
  let service: CandidatesService;
  let prisma: { candidate: { upsert: jest.Mock; findUniqueOrThrow: jest.Mock } };
  const originalSecret = process.env.EMAIL_HASH_SECRET;
  const originalEncryptionKey = process.env.EMAIL_ENCRYPTION_KEY;

  beforeEach(async () => {
    process.env.EMAIL_HASH_SECRET = 'test-secret';
    process.env.EMAIL_ENCRYPTION_KEY = 'a'.repeat(64);
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
    process.env.EMAIL_ENCRYPTION_KEY = originalEncryptionKey;
  });

  it('upserts on the hashed email, never the raw email', async () => {
    let capturedArgs:
      | { where: { emailHash: string }; create: { emailHash: string; emailEncrypted: string } }
      | undefined;
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
    // GitHub issue #335, D74 — the reversible copy notification-service
    // needs is written alongside the hash, but the stored value must
    // still never contain the plaintext.
    expect(capturedArgs?.create.emailEncrypted).toBeDefined();
    expect(capturedArgs?.create.emailEncrypted).not.toContain('candidate');
    expect(capturedArgs?.create.emailEncrypted).not.toContain('example.com');
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

  it('throws if EMAIL_ENCRYPTION_KEY is not configured', async () => {
    delete process.env.EMAIL_ENCRYPTION_KEY;

    await expect(service.create({ email: 'candidate@example.com' })).rejects.toThrow(
      'EMAIL_ENCRYPTION_KEY',
    );
  });
});
