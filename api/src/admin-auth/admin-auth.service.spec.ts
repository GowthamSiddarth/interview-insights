import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAuthService } from './admin-auth.service';
import { StaffAuditLogService } from './staff-audit-log.service';

describe('AdminAuthService', () => {
  let service: AdminAuthService;
  let jwtService: { sign: jest.Mock };
  let prisma: {
    moderator: { findUnique: jest.Mock; findUniqueOrThrow: jest.Mock; upsert: jest.Mock; update: jest.Mock };
  };
  let staffAuditLog: { record: jest.Mock };
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
    prisma = {
      moderator: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
      },
    };
    staffAuditLog = { record: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminAuthService,
        { provide: JwtService, useValue: jwtService },
        { provide: PrismaService, useValue: prisma },
        { provide: StaffAuditLogService, useValue: staffAuditLog },
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

  describe('changeOwnPassword', () => {
    it('updates the password hash and records a self-service audit row when the current password matches', async () => {
      prisma.moderator.findUniqueOrThrow.mockResolvedValue({ id: 'mod-1', passwordHash });

      await service.changeOwnPassword('mod-1', 'correct-horse-battery-staple', 'a-new-strong-password');

      expect(prisma.moderator.update).toHaveBeenCalledWith({
        where: { id: 'mod-1' },
        data: { passwordHash: expect.any(String) as string },
      });
      const [[updateCall]] = prisma.moderator.update.mock.calls as [[{ data: { passwordHash: string } }]];
      await expect(bcrypt.compare('a-new-strong-password', updateCall.data.passwordHash)).resolves.toBe(
        true,
      );
      expect(staffAuditLog.record).toHaveBeenCalledWith({
        actorId: 'mod-1',
        targetId: 'mod-1',
        action: 'password_reset',
      });
    });

    it('rejects with UnauthorizedException when the current password is wrong, without updating anything', async () => {
      prisma.moderator.findUniqueOrThrow.mockResolvedValue({ id: 'mod-1', passwordHash });

      await expect(
        service.changeOwnPassword('mod-1', 'wrong-current-password', 'a-new-strong-password'),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.moderator.update).not.toHaveBeenCalled();
      expect(staffAuditLog.record).not.toHaveBeenCalled();
    });
  });
});
