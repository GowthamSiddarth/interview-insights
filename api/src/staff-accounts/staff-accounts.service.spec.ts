import { ConflictException, ForbiddenException } from '@nestjs/common';
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
      count: jest.Mock;
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
        count: jest.fn(),
      },
    };
    staffAuditLog = { record: jest.fn().mockResolvedValue(undefined) };
    service = new StaffAccountsService(
      prisma as unknown as PrismaService,
      staffAuditLog as unknown as StaffAuditLogService,
    );
  });

  describe('list', () => {
    it('never selects passwordHash, and excludes the root admin (createdById: null)', async () => {
      prisma.moderator.findMany.mockResolvedValue([]);
      await service.list();

      const [[call]] = prisma.moderator.findMany.mock.calls as [
        [{ select: Record<string, boolean>; where: Record<string, unknown> }],
      ];
      expect(call.select.passwordHash).toBeUndefined();
      expect(call.where).toEqual({ createdById: { not: null } });
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

  describe('root admin guard (GitHub issue #607)', () => {
    it.each([
      ['updateRole', () => service.updateRole('mod-actor', 'root-id', 'staff')],
      ['deactivate', () => service.deactivate('mod-actor', 'root-id')],
      ['reactivate', () => service.reactivate('mod-actor', 'root-id')],
      ['resetPassword', () => service.resetPassword('mod-actor', 'root-id')],
    ])('%s rejects a target whose createdById is null (the root admin)', async (_name, call) => {
      prisma.moderator.findUniqueOrThrow.mockResolvedValue({
        role: 'admin',
        isActive: true,
        createdById: null,
      });

      await expect(call()).rejects.toThrow(ForbiddenException);
      expect(prisma.moderator.update).not.toHaveBeenCalled();
      expect(staffAuditLog.record).not.toHaveBeenCalled();
    });
  });

  describe('updateRole', () => {
    it('updates the role and records role_changed with old/new role in detail', async () => {
      prisma.moderator.findUniqueOrThrow.mockResolvedValue({
        role: 'staff',
        isActive: true,
        createdById: 'mod-actor',
      });
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

    it('rejects demoting the last remaining active non-root admin', async () => {
      prisma.moderator.findUniqueOrThrow.mockResolvedValue({
        role: 'admin',
        isActive: true,
        createdById: 'some-other-admin',
      });
      prisma.moderator.count.mockResolvedValue(0);

      await expect(service.updateRole('mod-actor', 'mod-1', 'moderator')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.moderator.count).toHaveBeenCalledWith({
        where: { role: 'admin', isActive: true, createdById: { not: null }, id: { not: 'mod-1' } },
      });
      expect(prisma.moderator.update).not.toHaveBeenCalled();
    });

    it('allows demoting an admin when another active non-root admin remains', async () => {
      prisma.moderator.findUniqueOrThrow.mockResolvedValue({
        role: 'admin',
        isActive: true,
        createdById: 'some-other-admin',
      });
      prisma.moderator.count.mockResolvedValue(1);
      prisma.moderator.update.mockResolvedValue({ id: 'mod-1', role: 'moderator' });

      await expect(service.updateRole('mod-actor', 'mod-1', 'moderator')).resolves.toMatchObject({
        role: 'moderator',
      });
    });

    it('does not run the last-admin check when the target is not currently an active admin', async () => {
      prisma.moderator.findUniqueOrThrow.mockResolvedValue({
        role: 'staff',
        isActive: true,
        createdById: 'some-other-admin',
      });
      prisma.moderator.update.mockResolvedValue({ id: 'mod-1', role: 'moderator' });

      await service.updateRole('mod-actor', 'mod-1', 'moderator');

      expect(prisma.moderator.count).not.toHaveBeenCalled();
    });
  });

  describe('deactivate / reactivate', () => {
    it('deactivate sets isActive: false and records deactivated, when another active non-root admin remains', async () => {
      prisma.moderator.findUniqueOrThrow.mockResolvedValue({
        role: 'admin',
        isActive: true,
        createdById: 'some-other-admin',
      });
      prisma.moderator.count.mockResolvedValue(1);
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

    it('rejects deactivating the last remaining active non-root admin', async () => {
      prisma.moderator.findUniqueOrThrow.mockResolvedValue({
        role: 'admin',
        isActive: true,
        createdById: 'some-other-admin',
      });
      prisma.moderator.count.mockResolvedValue(0);

      await expect(service.deactivate('mod-actor', 'mod-1')).rejects.toThrow(ConflictException);
      expect(prisma.moderator.update).not.toHaveBeenCalled();
    });

    it('deactivating a non-admin never runs the last-admin check', async () => {
      prisma.moderator.findUniqueOrThrow.mockResolvedValue({
        role: 'moderator',
        isActive: true,
        createdById: 'some-other-admin',
      });
      prisma.moderator.update.mockResolvedValue({ id: 'mod-1', isActive: false });

      await service.deactivate('mod-actor', 'mod-1');

      expect(prisma.moderator.count).not.toHaveBeenCalled();
    });

    it('reactivate sets isActive: true and records reactivated', async () => {
      prisma.moderator.findUniqueOrThrow.mockResolvedValue({ createdById: 'some-other-admin' });
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
      prisma.moderator.findUniqueOrThrow.mockResolvedValue({ createdById: 'some-other-admin' });
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
