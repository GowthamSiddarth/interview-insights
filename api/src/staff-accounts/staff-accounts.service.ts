import { Injectable } from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { StaffAuditLogService } from '../admin-auth/staff-audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStaffAccountDto } from './dto/create-staff-account.dto';
import { generateTemporaryPassword } from './temporary-password.util';

const BCRYPT_COST = 10;

// Never selects passwordHash — no response from this service ever carries
// it, only the one-time plaintext `password` returned by create()/
// resetPassword() below.
const STAFF_ACCOUNT_SELECT = {
  id: true,
  username: true,
  email: true,
  role: true,
  isActive: true,
  createdById: true,
  createdAt: true,
} as const;

export interface StaffAccountSummary {
  id: string;
  username: string;
  email: string;
  role: StaffRole;
  isActive: boolean;
  createdById: string | null;
  createdAt: Date;
}

// GitHub issue #589 (Phase 42, D99) — the admin:staff:manage side of the
// role hierarchy: create/list/update-role/deactivate/reactivate, admin-
// initiated password reset, every action durably audited via
// StaffAuditLogService. Deactivate, never delete — same precedent
// claimedById already set by never being cleared. No existence check
// before update/create: a missing target or duplicate username is left to
// Prisma's own P2025/P2002, mapped to 404/409 by PrismaExceptionFilter
// (same pattern round-type-registry's admin CRUD already uses).
@Injectable()
export class StaffAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly staffAuditLog: StaffAuditLogService,
  ) {}

  list(): Promise<StaffAccountSummary[]> {
    return this.prisma.moderator.findMany({
      select: STAFF_ACCOUNT_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(
    actorId: string,
    dto: CreateStaffAccountDto,
  ): Promise<StaffAccountSummary & { password: string }> {
    const password = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

    const created = await this.prisma.moderator.create({
      data: {
        username: dto.username,
        email: dto.email,
        role: dto.role,
        passwordHash,
        createdById: actorId,
      },
      select: STAFF_ACCOUNT_SELECT,
    });

    await this.staffAuditLog.record({
      actorId,
      targetId: created.id,
      action: 'account_created',
      detail: { role: created.role },
    });

    return { ...created, password };
  }

  async updateRole(actorId: string, targetId: string, role: StaffRole): Promise<StaffAccountSummary> {
    const before = await this.prisma.moderator.findUniqueOrThrow({
      where: { id: targetId },
      select: { role: true },
    });

    const updated = await this.prisma.moderator.update({
      where: { id: targetId },
      data: { role },
      select: STAFF_ACCOUNT_SELECT,
    });

    await this.staffAuditLog.record({
      actorId,
      targetId,
      action: 'role_changed',
      detail: { oldRole: before.role, newRole: role },
    });

    return updated;
  }

  async deactivate(actorId: string, targetId: string): Promise<StaffAccountSummary> {
    const updated = await this.prisma.moderator.update({
      where: { id: targetId },
      data: { isActive: false },
      select: STAFF_ACCOUNT_SELECT,
    });

    await this.staffAuditLog.record({ actorId, targetId, action: 'deactivated' });
    return updated;
  }

  async reactivate(actorId: string, targetId: string): Promise<StaffAccountSummary> {
    const updated = await this.prisma.moderator.update({
      where: { id: targetId },
      data: { isActive: true },
      select: STAFF_ACCOUNT_SELECT,
    });

    await this.staffAuditLog.record({ actorId, targetId, action: 'reactivated' });
    return updated;
  }

  async resetPassword(actorId: string, targetId: string): Promise<{ password: string }> {
    const password = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

    await this.prisma.moderator.update({ where: { id: targetId }, data: { passwordHash } });
    await this.staffAuditLog.record({ actorId, targetId, action: 'password_reset' });

    return { password };
  }
}
