import { UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminJwtStrategy } from './admin-jwt.strategy';

describe('AdminJwtStrategy', () => {
  const originalSecret = process.env.ADMIN_JWT_SECRET;
  let prisma: { moderator: { findUnique: jest.Mock } };

  beforeEach(() => {
    process.env.ADMIN_JWT_SECRET = 'test-secret';
    prisma = { moderator: { findUnique: jest.fn() } };
  });

  afterEach(() => {
    process.env.ADMIN_JWT_SECRET = originalSecret;
  });

  it('throws at construction if ADMIN_JWT_SECRET is not configured', () => {
    delete process.env.ADMIN_JWT_SECRET;
    expect(() => new AdminJwtStrategy(prisma as unknown as PrismaService)).toThrow(
      'ADMIN_JWT_SECRET',
    );
  });

  it('re-reads role/isActive from the DB by id, ignoring the JWT payload’s own role claim', async () => {
    prisma.moderator.findUnique.mockResolvedValue({
      id: 'mod-1',
      username: 'admin',
      role: 'admin',
      isActive: true,
    });
    const strategy = new AdminJwtStrategy(prisma as unknown as PrismaService);

    const result = await strategy.validate({ id: 'mod-1', username: 'admin', role: 'staff' });
    expect(result).toEqual({ id: 'mod-1', username: 'admin', role: 'admin' });
    expect(prisma.moderator.findUnique).toHaveBeenCalledWith({ where: { id: 'mod-1' } });
  });

  it('strips jwt.sign()-added claims like iat/exp, keeping only id/username/role', async () => {
    prisma.moderator.findUnique.mockResolvedValue({
      id: 'mod-1',
      username: 'admin',
      role: 'admin',
      isActive: true,
    });
    const strategy = new AdminJwtStrategy(prisma as unknown as PrismaService);

    const decoded = {
      id: 'mod-1',
      username: 'admin',
      role: 'admin' as const,
      iat: 1700000000,
      exp: 1700003600,
    };
    await expect(strategy.validate(decoded)).resolves.toEqual({
      id: 'mod-1',
      username: 'admin',
      role: 'admin',
    });
  });

  it('rejects a session whose account was deactivated since the token was issued', async () => {
    prisma.moderator.findUnique.mockResolvedValue({
      id: 'mod-2',
      username: 'second-moderator',
      role: 'moderator',
      isActive: false,
    });
    const strategy = new AdminJwtStrategy(prisma as unknown as PrismaService);

    await expect(
      strategy.validate({ id: 'mod-2', username: 'second-moderator', role: 'moderator' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a session whose account no longer exists', async () => {
    prisma.moderator.findUnique.mockResolvedValue(null);
    const strategy = new AdminJwtStrategy(prisma as unknown as PrismaService);

    await expect(
      strategy.validate({ id: 'gone', username: 'gone', role: 'staff' }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
