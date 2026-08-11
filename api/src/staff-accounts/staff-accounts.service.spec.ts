import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { StaffAuditLogService } from '../admin-auth/staff-audit-log.service';
import { CreateStaffAccountDto } from './dto/create-staff-account.dto';
import { StaffAccountsService } from './staff-accounts.service';

describe('StaffAccountsService', () => {
  let service: StaffAccountsService;
  let prisma: {
    moderator: {
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
  };
  let staffAuditLog: { record: jest.Mock };

  beforeEach(() => {
    prisma = {
      moderator: {
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
    };
    staffAuditLog = { record: jest.fn().mockResolvedValue(undefined) };
    service = new StaffAccountsService(
      prisma as unknown as PrismaService,
      staffAuditLog as unknown as StaffAuditLogService,
    );
  });

  describe('list', () => {
    it('never selects passwordHash', async () => {
      prisma.moderator.findMany.mockResolvedValue([]);
      await service.list();

      const [[call]] = prisma.moderator.findMany.mock.calls as [
        [{ select: Record<string, boolean> }],
      ];
      expect(call.select.passwordHash).toBeUndefined();
    });
  });

  describe('create', () => {
    it('creates the account with a bcrypt-hashed random password, records account_created, and returns the plaintext password once', async () => {
      const dto: CreateStaffAccountDto = { username: 'new-staff', email: 'new@example.com', role: 'staff' };
      prisma.moderator.create.mockImplementation(
        ({ data }: { data: { role: string } }) =>
          Promise.resolve({
            id: 'mod-new',
            username: 'new-staff',
            email: 'new@example.com',
            role: data.role,
            isActive: true,
            createdById: 'mod-actor',
            createdAt: new Date('2026-08-11T00:00:00Z'),
          }),
      );

      const result = await service.create('mod-actor', dto);

      expect(result.id).toBe('mod-new');
      expect(typeof result.password).toBe('string');
      expect(result.password.length).toBeGreaterThan(0);

      const [[createCall]] = prisma.moderator.create.mock.calls as [
        [{ data: { passwordHash: string; createdById: string } }],
      ];
      expect(createCall.data.createdById).toBe('mod-actor');
      await expect(bcrypt.compare(result.password, createCall.data.passwordHash)).resolves.toBe(true);

      expect(staffAuditLog.record).toHaveBeenCalledWith({
        actorId: 'mod-actor',
        targetId: 'mod-new',
        action: 'account_created',
        detail: { role: 'staff' },
      });
    });
  });

  describe('updateRole', () => {
    it('updates the role and records role_changed with old/new role in detail', async () => {
      prisma.moderator.findUniqueOrThrow.mockResolvedValue({ role: 'staff' });
      prisma.moderator.update.mockResolvedValue({
        id: 'mod-1',
        username: 'someone',
        email: 'someone@example.com',
        role: 'moderator',
        isActive: true,
        createdById: 'mod-actor',
        createdAt: new Date(),
      });

      const result = await service.updateRole('mod-actor', 'mod-1', 'moderator');

      expect(result.role).toBe('moderator');
      expect(staffAuditLog.record).toHaveBeenCalledWith({
        actorId: 'mod-actor',
        targetId: 'mod-1',
        action: 'role_changed',
        detail: { oldRole: 'staff', newRole: 'moderator' },
      });
    });
  });

  describe('deactivate / reactivate', () => {
    it('deactivate sets isActive: false and records deactivated', async () => {
      prisma.moderator.update.mockResolvedValue({ id: 'mod-1', isActive: false });

      await service.deactivate('mod-actor', 'mod-1');

      expect(prisma.moderator.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'mod-1' }, data: { isActive: false } }),
      );
      expect(staffAuditLog.record).toHaveBeenCalledWith({
        actorId: 'mod-actor',
        targetId: 'mod-1',
        action: 'deactivated',
      });
    });

    it('reactivate sets isActive: true and records reactivated', async () => {
      prisma.moderator.update.mockResolvedValue({ id: 'mod-1', isActive: true });

      await service.reactivate('mod-actor', 'mod-1');

      expect(prisma.moderator.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'mod-1' }, data: { isActive: true } }),
      );
      expect(staffAuditLog.record).toHaveBeenCalledWith({
        actorId: 'mod-actor',
        targetId: 'mod-1',
        action: 'reactivated',
      });
    });
  });

  describe('resetPassword', () => {
    it('sets a new bcrypt-hashed random password and records password_reset, returning the plaintext once', async () => {
      prisma.moderator.update.mockResolvedValue({});

      const result = await service.resetPassword('mod-actor', 'mod-1');

      expect(typeof result.password).toBe('string');
      const [[updateCall]] = prisma.moderator.update.mock.calls as [
        [{ where: { id: string }; data: { passwordHash: string } }],
      ];
      expect(updateCall.where).toEqual({ id: 'mod-1' });
      await expect(bcrypt.compare(result.password, updateCall.data.passwordHash)).resolves.toBe(true);

      expect(staffAuditLog.record).toHaveBeenCalledWith({
        actorId: 'mod-actor',
        targetId: 'mod-1',
        action: 'password_reset',
      });
    });
  });
});
