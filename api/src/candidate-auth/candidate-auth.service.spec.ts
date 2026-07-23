import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, GoneException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CandidatesService } from '../candidates/candidates.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { CandidateAuthService } from './candidate-auth.service';

describe('CandidateAuthService', () => {
  let service: CandidateAuthService;
  let prisma: {
    candidateVerificationToken: {
      updateMany: jest.Mock;
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    candidate: { update: jest.Mock; findUniqueOrThrow: jest.Mock };
    $transaction: jest.Mock;
  };
  let candidatesService: { create: jest.Mock };
  let mailService: { send: jest.Mock };
  let jwtService: { sign: jest.Mock };

  beforeEach(async () => {
    prisma = {
      candidateVerificationToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({ id: 'token-row-1' }),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      candidate: {
        update: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(prisma)),
    };
    candidatesService = { create: jest.fn().mockResolvedValue({ id: 'candidate-1' }) };
    mailService = { send: jest.fn().mockResolvedValue(undefined) };
    jwtService = { sign: jest.fn().mockReturnValue('signed.jwt.token') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CandidateAuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: CandidatesService, useValue: candidatesService },
        { provide: MailService, useValue: mailService },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get(CandidateAuthService);
  });

  describe('requestLink', () => {
    it('upserts the candidate via CandidatesService, supersedes any prior token, issues a new one, and emails it', async () => {
      await service.requestLink('candidate@example.com');

      expect(candidatesService.create).toHaveBeenCalledWith({ email: 'candidate@example.com' });
      expect(prisma.candidateVerificationToken.updateMany).toHaveBeenCalledWith({
        where: { candidateId: 'candidate-1', consumedAt: null },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any() is typed `any` by @types/jest
        data: { consumedAt: expect.any(Date) },
      });
      expect(prisma.candidateVerificationToken.create).toHaveBeenCalledWith({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining() is typed `any` by @types/jest
        data: expect.objectContaining({ candidateId: 'candidate-1' }),
      });
      expect(mailService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'candidate@example.com',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.stringContaining() is typed `any` by @types/jest
          text: expect.stringContaining('/auth/verify?token='),
        }),
      );
    });

    it('never persists the raw token, only its hash', async () => {
      await service.requestLink('candidate@example.com');

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- jest.Mock's .mock.calls is typed `any[]`
      const createArgs = prisma.candidateVerificationToken.create.mock.calls[0][0] as {
        data: { tokenHash: string };
      };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- jest.Mock's .mock.calls is typed `any[]`
      const sentText = mailService.send.mock.calls[0][0].text as string;
      const rawToken = /token=([0-9a-f]+)/.exec(sentText)?.[1];
      expect(rawToken).toBeDefined();
      expect(createArgs.data.tokenHash).not.toBe(rawToken);
    });
  });

  describe('verify', () => {
    it('throws NotFoundException for an unknown token', async () => {
      prisma.candidateVerificationToken.findUnique.mockResolvedValue(null);
      await expect(service.verify('unknown')).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException for an already-consumed token', async () => {
      prisma.candidateVerificationToken.findUnique.mockResolvedValue({
        id: 'token-row-1',
        candidateId: 'candidate-1',
        consumedAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
      });
      await expect(service.verify('used')).rejects.toThrow(ConflictException);
    });

    it('throws GoneException for an expired token', async () => {
      prisma.candidateVerificationToken.findUnique.mockResolvedValue({
        id: 'token-row-1',
        candidateId: 'candidate-1',
        consumedAt: null,
        expiresAt: new Date(Date.now() - 1000),
      });
      await expect(service.verify('expired')).rejects.toThrow(GoneException);
    });

    it('consumes the token and flips verificationStatus on first login', async () => {
      prisma.candidateVerificationToken.findUnique.mockResolvedValue({
        id: 'token-row-1',
        candidateId: 'candidate-1',
        consumedAt: null,
        expiresAt: new Date(Date.now() + 60000),
      });
      prisma.candidate.findUniqueOrThrow.mockResolvedValue({
        id: 'candidate-1',
        verificationStatus: 'unverified',
      });
      prisma.candidate.update.mockResolvedValue({ id: 'candidate-1' });

      const result = await service.verify('valid-token');

      expect(prisma.candidateVerificationToken.update).toHaveBeenCalledWith({
        where: { id: 'token-row-1' },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any() is typed `any` by @types/jest
        data: { consumedAt: expect.any(Date) },
      });
      expect(prisma.candidate.update).toHaveBeenCalledWith({
        where: { id: 'candidate-1' },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any() is typed `any` by @types/jest
        data: { verificationStatus: 'email_verified', verifiedAt: expect.any(Date) },
      });
      expect(result).toEqual({ candidateId: 'candidate-1' });
    });

    it('does not overwrite verifiedAt on a repeat login', async () => {
      prisma.candidateVerificationToken.findUnique.mockResolvedValue({
        id: 'token-row-2',
        candidateId: 'candidate-1',
        consumedAt: null,
        expiresAt: new Date(Date.now() + 60000),
      });
      prisma.candidate.findUniqueOrThrow.mockResolvedValue({
        id: 'candidate-1',
        verificationStatus: 'email_verified',
      });

      const result = await service.verify('valid-token-2');

      expect(prisma.candidate.update).not.toHaveBeenCalled();
      expect(result).toEqual({ candidateId: 'candidate-1' });
    });
  });

  describe('issueToken', () => {
    it('signs a JWT with the session payload', () => {
      const token = service.issueToken({ candidateId: 'candidate-1' });
      expect(token).toBe('signed.jwt.token');
      expect(jwtService.sign).toHaveBeenCalledWith({ candidateId: 'candidate-1' });
    });
  });
});
