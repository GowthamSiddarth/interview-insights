import { Test, TestingModule } from '@nestjs/testing';
import { StaffNotificationRecipientsService } from './staff-notification-recipients.service';
import { PrismaService } from '../prisma/prisma.service';

describe('StaffNotificationRecipientsService', () => {
  let service: StaffNotificationRecipientsService;
  let prisma: { moderator: { findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = { moderator: { findMany: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [StaffNotificationRecipientsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(StaffNotificationRecipientsService);
  });

  describe('activeModeratorEmails', () => {
    it('queries active moderator and admin accounts, excluding staff and inactive accounts', async () => {
      prisma.moderator.findMany.mockResolvedValue([
        { email: 'mod-a@example.com' },
        { email: 'admin-a@example.com' },
      ]);

      const emails = await service.activeModeratorEmails();

      expect(prisma.moderator.findMany).toHaveBeenCalledWith({
        where: { isActive: true, role: { in: ['moderator', 'admin'] } },
        select: { email: true },
      });
      expect(emails).toEqual(['mod-a@example.com', 'admin-a@example.com']);
    });

    it('returns an empty array when no active moderators exist', async () => {
      prisma.moderator.findMany.mockResolvedValue([]);

      await expect(service.activeModeratorEmails()).resolves.toEqual([]);
    });
  });

  describe('activeAdminEmails', () => {
    it('queries only active admin accounts', async () => {
      prisma.moderator.findMany.mockResolvedValue([{ email: 'admin-a@example.com' }]);

      const emails = await service.activeAdminEmails();

      expect(prisma.moderator.findMany).toHaveBeenCalledWith({
        where: { isActive: true, role: 'admin' },
        select: { email: true },
      });
      expect(emails).toEqual(['admin-a@example.com']);
    });
  });
});
