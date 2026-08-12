import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
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
// before create: a duplicate username is left to Prisma's own P2002,
// mapped to 409 by PrismaExceptionFilter (same pattern round-type-
// registry's admin CRUD already uses).
//
// GitHub issue #607 — the root admin (createdById: null, D99's "exactly
// one root ADMIN stays imperatively boot-seeded") is deliberately never
// listed or actionable through this API. Every mutation against it is a
// silent no-op in practice anyway: AdminAuthService.onModuleInit() resets
// its role/isActive/passwordHash from env on every boot regardless of
// what this API did to it in between, so exposing it here would just let
// an operator "successfully" change something that reverts on the next
// restart with no indication why. Root is managed by
// infra/scripts/rotate-admin-credentials.sh only.
@Injectable()
export class StaffAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly staffAuditLog: StaffAuditLogService,
  ) {}

  private assertNotRoot(target: { createdById: string | null }): void {
    if (target.createdById === null) {
      throw new ForbiddenException(
        'The root admin account is managed via infra/scripts/rotate-admin-credentials.sh, not this API.',
      );
    }
  }

  // Excludes the root admin (createdById: null) — see class comment.
  list(): Promise<StaffAccountSummary[]> {
    return this.prisma.moderator.findMany({
      where: { createdById: { not: null } },
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

  // GitHub issue #607 — the root admin is always excluded from this count
  // (see class comment: it's never listed or actionable here, so it can
  // never be the "last one" a demotion/deactivation needs to preserve).
  // Counting it would make the guard below meaningless — root's own
  // boot-time self-heal means it's *always* isActive/role:'admin', so an
  // operator could deactivate every account actually visible in the UI
  // and this check would never fire.
  private countOtherActiveNonRootAdmins(excludeId: string): Promise<number> {
    return this.prisma.moderator.count({
      where: { role: 'admin', isActive: true, createdById: { not: null }, id: { not: excludeId } },
    });
  }

  async updateRole(actorId: string, targetId: string, role: StaffRole): Promise<StaffAccountSummary> {
    const before = await this.prisma.moderator.findUniqueOrThrow({
      where: { id: targetId },
      select: { role: true, isActive: true, createdById: true },
    });
    this.assertNotRoot(before);

    // Demoting the last remaining non-root admin away from 'admin' has the
    // same effect as deactivating them — no manageable admin left — so it
    // gets the same guard, not just deactivate() below.
    if (before.role === 'admin' && before.isActive && role !== 'admin') {
      const remaining = await this.countOtherActiveNonRootAdmins(targetId);
      if (remaining === 0) {
        throw new ConflictException(
          'Cannot change the role of the last remaining active admin account.',
        );
      }
    }

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
    const target = await this.prisma.moderator.findUniqueOrThrow({
      where: { id: targetId },
      select: { role: true, isActive: true, createdById: true },
    });
    this.assertNotRoot(target);

    if (target.role === 'admin' && target.isActive) {
      const remaining = await this.countOtherActiveNonRootAdmins(targetId);
      if (remaining === 0) {
        throw new ConflictException('Cannot deactivate the last remaining active admin account.');
      }
    }

    const updated = await this.prisma.moderator.update({
      where: { id: targetId },
      data: { isActive: false },
      select: STAFF_ACCOUNT_SELECT,
    });

    await this.staffAuditLog.record({ actorId, targetId, action: 'deactivated' });
    return updated;
  }

  async reactivate(actorId: string, targetId: string): Promise<StaffAccountSummary> {
    const target = await this.prisma.moderator.findUniqueOrThrow({
      where: { id: targetId },
      select: { createdById: true },
    });
    this.assertNotRoot(target);

    const updated = await this.prisma.moderator.update({
      where: { id: targetId },
      data: { isActive: true },
      select: STAFF_ACCOUNT_SELECT,
    });

    await this.staffAuditLog.record({ actorId, targetId, action: 'reactivated' });
    return updated;
  }

  async resetPassword(actorId: string, targetId: string): Promise<{ password: string }> {
    const target = await this.prisma.moderator.findUniqueOrThrow({
      where: { id: targetId },
      select: { createdById: true },
    });
    this.assertNotRoot(target);

    const password = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

    await this.prisma.moderator.update({ where: { id: targetId }, data: { passwordHash } });
    await this.staffAuditLog.record({ actorId, targetId, action: 'password_reset' });

    return { password };
  }
}
