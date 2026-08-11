import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAuthService } from './admin-auth.service';

describe('AdminAuthService', () => {
  let service: AdminAuthService;
  let jwtService: { sign: jest.Mock };
  let prisma: { moderator: { findUnique: jest.Mock; upsert: jest.Mock } };
  const originalEnv = { ...process.env };
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await bcrypt.hash('correct-horse-battery-staple', 10);
  });

  beforeEach(async () => {
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD_HASH = passwordHash;
    process.env.ADMIN_EMAIL = 'admin@interview-insights.local';

    jwtService = { sign: jest.fn().mockReturnValue('signed.jwt.token') };
    prisma = { moderator: { findUnique: jest.fn(), upsert: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminAuthService,
        { provide: JwtService, useValue: jwtService },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(AdminAuthService);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('validateAdmin', () => {
    it('validates correct credentials against the stored Moderator row', async () => {
      prisma.moderator.findUnique.mockResolvedValue({
        id: 'mod-1',
        username: 'admin',
        passwordHash,
        email: 'admin@interview-insights.local',
        role: 'admin',
        isActive: true,
      });

      const result = await service.validateAdmin('admin', 'correct-horse-battery-staple');
      expect(result).toEqual({ id: 'mod-1', username: 'admin', role: 'admin' });
      expect(prisma.moderator.findUnique).toHaveBeenCalledWith({ where: { username: 'admin' } });
    });

    it('rejects a wrong password', async () => {
      prisma.moderator.findUnique.mockResolvedValue({
        id: 'mod-1',
        username: 'admin',
        passwordHash,
        email: 'admin@interview-insights.local',
        role: 'admin',
        isActive: true,
      });

      const result = await service.validateAdmin('admin', 'wrong-password');
      expect(result).toBeNull();
    });

    it('rejects a username with no matching Moderator row, without touching bcrypt', async () => {
      prisma.moderator.findUnique.mockResolvedValue(null);

      const result = await service.validateAdmin('someone-else', 'correct-horse-battery-staple');
      expect(result).toBeNull();
    });

    it('rejects a deactivated account even with the correct password', async () => {
      prisma.moderator.findUnique.mockResolvedValue({
        id: 'mod-2',
        username: 'second-moderator',
        passwordHash,
        email: 'second-moderator@interview-insights.local',
        role: 'moderator',
        isActive: false,
      });

      const result = await service.validateAdmin('second-moderator', 'correct-horse-battery-staple');
      expect(result).toBeNull();
    });

    it('rejects non-string credentials without throwing or querying the DB', async () => {
      await expect(service.validateAdmin(undefined, undefined)).resolves.toBeNull();
      await expect(service.validateAdmin(['admin'], 123)).resolves.toBeNull();
      expect(prisma.moderator.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('onModuleInit', () => {
    it('upserts the env-configured moderator by username', async () => {
      await service.onModuleInit();

      expect(prisma.moderator.upsert).toHaveBeenCalledWith({
        where: { username: 'admin' },
        create: {
          username: 'admin',
          passwordHash,
          email: 'admin@interview-insights.local',
          role: 'admin',
          isActive: true,
        },
        update: {
          passwordHash,
          email: 'admin@interview-insights.local',
          role: 'admin',
          isActive: true,
        },
      });
    });

    it('throws if ADMIN_USERNAME is not configured', async () => {
      delete process.env.ADMIN_USERNAME;
      await expect(service.onModuleInit()).rejects.toThrow('ADMIN_USERNAME');
      expect(prisma.moderator.upsert).not.toHaveBeenCalled();
    });

    it('throws if ADMIN_PASSWORD_HASH is not configured', async () => {
      delete process.env.ADMIN_PASSWORD_HASH;
      await expect(service.onModuleInit()).rejects.toThrow('ADMIN_PASSWORD_HASH');
      expect(prisma.moderator.upsert).not.toHaveBeenCalled();
    });

    it('throws if ADMIN_EMAIL is not configured', async () => {
      delete process.env.ADMIN_EMAIL;
      await expect(service.onModuleInit()).rejects.toThrow('ADMIN_EMAIL');
      expect(prisma.moderator.upsert).not.toHaveBeenCalled();
    });
  });

  it('signs a JWT with the session payload', () => {
    const token = service.issueToken({ id: 'mod-1', username: 'admin', role: 'admin' });
    expect(token).toBe('signed.jwt.token');
    expect(jwtService.sign).toHaveBeenCalledWith({ id: 'mod-1', username: 'admin', role: 'admin' });
  });
});
