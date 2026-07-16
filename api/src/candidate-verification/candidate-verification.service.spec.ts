import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, GoneException, NotFoundException } from '@nestjs/common';
import { CandidateVerificationService } from './candidate-verification.service';
import { PrismaService } from '../prisma/prisma.service';
import { hashVerificationToken } from './verification-token.util';

describe('CandidateVerificationService', () => {
  let service: CandidateVerificationService;
  let prisma: {
    candidateVerificationToken: {
      updateMany: jest.Mock;
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    candidate: { update: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      candidateVerificationToken: {
        updateMany: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      candidate: { update: jest.fn() },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [CandidateVerificationService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(CandidateVerificationService);
  });

  describe('issueToken', () => {
    it('supersedes any previously unconsumed tokens for the candidate before issuing a new one', async () => {
      const result = await service.issueToken('candidate-1');

      expect(prisma.candidateVerificationToken.updateMany).toHaveBeenCalledWith({
        where: { candidateId: 'candidate-1', consumedAt: null },
        data: { consumedAt: expect.any(Date) as Date },
      });
      expect(prisma.candidateVerificationToken.create).toHaveBeenCalled();
      expect(result.token).toHaveLength(64);
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('stores only the hash, never the raw token', async () => {
      let createArgs: { data: { candidateId: string; tokenHash: string } } | undefined;
      prisma.candidateVerificationToken.create.mockImplementation((args: typeof createArgs) => {
        createArgs = args;
        return Promise.resolve({});
      });

      const result = await service.issueToken('candidate-1');

      expect(createArgs?.data.candidateId).toBe('candidate-1');
      expect(createArgs?.data.tokenHash).toBe(hashVerificationToken(result.token));
      expect(createArgs?.data.tokenHash).not.toBe(result.token);
    });
  });

  describe('verify', () => {
    function mockValidToken() {
      prisma.candidateVerificationToken.findUnique.mockResolvedValue({
        id: 'token-1',
        candidateId: 'candidate-1',
        consumedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });
      prisma.candidate.update.mockResolvedValue({
        id: 'candidate-1',
        verificationStatus: 'email_verified',
        verifiedAt: new Date(),
        createdAt: new Date('2026-01-01'),
      });
    }

    it('marks the token consumed and the candidate email_verified', async () => {
      mockValidToken();

      const result = await service.verify('raw-token');

      expect(prisma.candidateVerificationToken.update).toHaveBeenCalledWith({
        where: { id: 'token-1' },
        data: { consumedAt: expect.any(Date) as Date },
      });
      expect(prisma.candidate.update).toHaveBeenCalledWith({
        where: { id: 'candidate-1' },
        data: { verificationStatus: 'email_verified', verifiedAt: expect.any(Date) as Date },
      });
      expect(result).toMatchObject({ id: 'candidate-1', verificationStatus: 'email_verified' });
      expect(result).not.toHaveProperty('emailHash');
    });

    it('throws NotFoundException for an unknown token', async () => {
      prisma.candidateVerificationToken.findUnique.mockResolvedValue(null);

      await expect(service.verify('nope')).rejects.toThrow(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws ConflictException for an already-used token', async () => {
      prisma.candidateVerificationToken.findUnique.mockResolvedValue({
        id: 'token-1',
        candidateId: 'candidate-1',
        consumedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });

      await expect(service.verify('used-token')).rejects.toThrow(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws GoneException for an expired token', async () => {
      prisma.candidateVerificationToken.findUnique.mockResolvedValue({
        id: 'token-1',
        candidateId: 'candidate-1',
        consumedAt: null,
        expiresAt: new Date(Date.now() - 60_000),
      });

      await expect(service.verify('expired-token')).rejects.toThrow(GoneException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
