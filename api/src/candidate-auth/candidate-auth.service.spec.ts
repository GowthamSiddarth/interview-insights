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
    candidate: {
      update: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      findUnique: jest.Mock;
      upsert: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let candidatesService: { create: jest.Mock };
  let mailService: { send: jest.Mock };
  let jwtService: { sign: jest.Mock };

  const originalSecret = process.env.EMAIL_HASH_SECRET;
  const originalEncryptionKey = process.env.EMAIL_ENCRYPTION_KEY;

  beforeEach(async () => {
    process.env.EMAIL_HASH_SECRET = 'test-secret';
    process.env.EMAIL_ENCRYPTION_KEY = 'a'.repeat(64);

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
        findUnique: jest.fn(),
        upsert: jest.fn(),
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

  afterEach(() => {
    process.env.EMAIL_HASH_SECRET = originalSecret;
    process.env.EMAIL_ENCRYPTION_KEY = originalEncryptionKey;
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
        tokenVersion: 0,
      });
      prisma.candidate.update.mockResolvedValue({ id: 'candidate-1', tokenVersion: 0 });

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
      expect(result).toEqual({ candidateId: 'candidate-1', tokenVersion: 0 });
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
        tokenVersion: 0,
      });

      const result = await service.verify('valid-token-2');

      expect(prisma.candidate.update).not.toHaveBeenCalled();
      expect(result).toEqual({ candidateId: 'candidate-1', tokenVersion: 0 });
    });
  });

  // GitHub issue #680 (Phase 48, D104) — password registration.
  describe('register', () => {
    it('hashes the password, upserts the candidate, and sends a verification email', async () => {
      prisma.candidate.findUnique.mockResolvedValue(null);
      prisma.candidate.upsert.mockResolvedValue({ id: 'candidate-1', tokenVersion: 0 });

      const result = await service.register('candidate@example.com', 'a-strong-password');

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- jest.Mock's .mock.calls is typed `any[]`
      const upsertArgs = prisma.candidate.upsert.mock.calls[0][0] as {
        create: { passwordHash: string; passwordSetAt: Date };
      };
      expect(upsertArgs.create.passwordHash).not.toBe('a-strong-password');
      expect(upsertArgs.create.passwordSetAt).toBeInstanceOf(Date);
      expect(mailService.send).toHaveBeenCalledWith(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.stringContaining() is typed `any` by @types/jest
        expect.objectContaining({ to: 'candidate@example.com', subject: expect.stringContaining('Verify') }),
      );
      expect(result).toEqual({ candidateId: 'candidate-1', tokenVersion: 0 });
    });

    it('rejects re-registering an email that already has a password set', async () => {
      prisma.candidate.findUnique.mockResolvedValue({ id: 'candidate-1', passwordHash: 'existing-hash' });

      await expect(service.register('candidate@example.com', 'a-strong-password')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.candidate.upsert).not.toHaveBeenCalled();
    });

    it('still succeeds even if the verification email fails to send', async () => {
      prisma.candidate.findUnique.mockResolvedValue(null);
      prisma.candidate.upsert.mockResolvedValue({ id: 'candidate-1', tokenVersion: 0 });
      mailService.send.mockRejectedValue(new Error('Mailpit unreachable'));

      await expect(service.register('candidate@example.com', 'a-strong-password')).resolves.toEqual({
        candidateId: 'candidate-1',
        tokenVersion: 0,
      });
    });
  });

  // GitHub issue #681 (Phase 48, D104) — password login.
  describe('login', () => {
    it('returns the session payload for a correct password', async () => {
      const bcrypt = await import('bcryptjs');
      const passwordHash = await bcrypt.hash('correct-password', 10);
      prisma.candidate.findUnique.mockResolvedValue({ id: 'candidate-1', passwordHash, tokenVersion: 2 });

      const result = await service.login('candidate@example.com', 'correct-password');

      expect(result).toEqual({ candidateId: 'candidate-1', tokenVersion: 2 });
    });

    it('rejects an unknown email with the same message as a wrong password', async () => {
      prisma.candidate.findUnique.mockResolvedValue(null);

      await expect(service.login('unknown@example.com', 'whatever')).rejects.toThrow('Invalid email or password.');
    });

    it('rejects a candidate who has never set a password (magic-link only)', async () => {
      prisma.candidate.findUnique.mockResolvedValue({ id: 'candidate-1', passwordHash: null, tokenVersion: 0 });

      await expect(service.login('candidate@example.com', 'whatever')).rejects.toThrow('Invalid email or password.');
    });

    it('rejects an incorrect password', async () => {
      const bcrypt = await import('bcryptjs');
      const passwordHash = await bcrypt.hash('correct-password', 10);
      prisma.candidate.findUnique.mockResolvedValue({ id: 'candidate-1', passwordHash, tokenVersion: 0 });

      await expect(service.login('candidate@example.com', 'wrong-password')).rejects.toThrow(
        'Invalid email or password.',
      );
    });
  });

  describe('issueToken', () => {
    it('signs a JWT with the session payload', () => {
      const token = service.issueToken({ candidateId: 'candidate-1', tokenVersion: 0 });
      expect(token).toBe('signed.jwt.token');
      expect(jwtService.sign).toHaveBeenCalledWith({ candidateId: 'candidate-1', tokenVersion: 0 });
    });
  });
});
