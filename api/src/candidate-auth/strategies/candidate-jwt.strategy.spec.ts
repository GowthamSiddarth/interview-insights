import { UnauthorizedException } from '@nestjs/common';
import { CandidateJwtStrategy } from './candidate-jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';

describe('CandidateJwtStrategy', () => {
  const originalSecret = process.env.CANDIDATE_JWT_SECRET;
  let prisma: { candidate: { findUnique: jest.Mock } };

  beforeEach(() => {
    prisma = { candidate: { findUnique: jest.fn() } };
  });

  afterEach(() => {
    process.env.CANDIDATE_JWT_SECRET = originalSecret;
  });

  it('throws at construction if CANDIDATE_JWT_SECRET is not configured', () => {
    delete process.env.CANDIDATE_JWT_SECRET;
    expect(() => new CandidateJwtStrategy(prisma as unknown as PrismaService)).toThrow(
      'CANDIDATE_JWT_SECRET',
    );
  });

  it('passes the session payload through when the candidate still exists', async () => {
    process.env.CANDIDATE_JWT_SECRET = 'test-secret';
    prisma.candidate.findUnique.mockResolvedValue({ id: 'candidate-1' });
    const strategy = new CandidateJwtStrategy(prisma as unknown as PrismaService);

    await expect(strategy.validate({ candidateId: 'candidate-1' })).resolves.toEqual({
      candidateId: 'candidate-1',
    });
    expect(prisma.candidate.findUnique).toHaveBeenCalledWith({ where: { id: 'candidate-1' } });
  });

  it('strips jwt.sign()-added claims like iat/exp, keeping only candidateId', async () => {
    process.env.CANDIDATE_JWT_SECRET = 'test-secret';
    prisma.candidate.findUnique.mockResolvedValue({ id: 'candidate-1' });
    const strategy = new CandidateJwtStrategy(prisma as unknown as PrismaService);
    const decoded = { candidateId: 'candidate-1', iat: 1700000000, exp: 1700003600 };

    await expect(strategy.validate(decoded)).resolves.toEqual({ candidateId: 'candidate-1' });
  });

  // GitHub issue #151: a stale token (e.g. copied, or a second device)
  // surviving after DELETE /me erased the account must get a clean 401,
  // not a downstream FK/not-found error the first time it's used.
  it('throws UnauthorizedException when the candidateId no longer exists (post-erasure)', async () => {
    process.env.CANDIDATE_JWT_SECRET = 'test-secret';
    prisma.candidate.findUnique.mockResolvedValue(null);
    const strategy = new CandidateJwtStrategy(prisma as unknown as PrismaService);

    await expect(strategy.validate({ candidateId: 'candidate-1' })).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
