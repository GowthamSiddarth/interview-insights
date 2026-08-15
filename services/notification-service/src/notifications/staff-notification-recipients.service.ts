import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// GitHub issue #703 (Phase 51, D104) — resolves "who to notify" for a
// broadcast that isn't addressed to one specific staff.account.* target
// (#705's own single-recipient emails already have their target's email
// directly on the event, no resolution needed). Shared by two consumers
// (#704's tiered SLA escalation): the 75%-elapsed warning tier, and the
// 100%-elapsed-unclaimed escalation tier — one implementation rather than
// each building its own ad hoc query.
@Injectable()
export class StaffNotificationRecipientsService {
  constructor(private readonly prisma: PrismaService) {}

  // Anyone who can actually claim/approve/reject a moderation queue
  // entry — both the `moderator` and `admin` roles (api's own
  // permissions.ts: ADMIN_PERMISSIONS is a strict superset of
  // MODERATOR_PERMISSIONS), excluding `staff` (read-only, D99).
  async activeModeratorEmails(): Promise<string[]> {
    const rows = await this.prisma.moderator.findMany({
      where: { isActive: true, role: { in: ['moderator', 'admin'] } },
      select: { email: true },
    });
    return rows.map((r) => r.email);
  }

  // admin:staff:manage tier only.
  async activeAdminEmails(): Promise<string[]> {
    const rows = await this.prisma.moderator.findMany({
      where: { isActive: true, role: 'admin' },
      select: { email: true },
    });
    return rows.map((r) => r.email);
  }
}
