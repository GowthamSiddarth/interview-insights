import { randomUUID } from 'crypto';
import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { StaffAuditLogService } from '../admin-auth/staff-audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventPublisher } from '../events/domain-event-publisher';
import {
  STAFF_ACCOUNT_CREATED_V1_TOPIC,
  StaffAccountCreatedEventV1,
} from '../events/schemas/staff-account-created.event';
import {
  STAFF_ACCOUNT_ROLE_CHANGED_V1_TOPIC,
  StaffAccountRoleChangedEventV1,
} from '../events/schemas/staff-account-role-changed.event';
import {
  STAFF_ACCOUNT_DEACTIVATED_V1_TOPIC,
  StaffAccountDeactivatedEventV1,
} from '../events/schemas/staff-account-deactivated.event';
import {
  STAFF_ACCOUNT_REACTIVATED_V1_TOPIC,
  StaffAccountReactivatedEventV1,
} from '../events/schemas/staff-account-reactivated.event';
import {
  STAFF_ACCOUNT_PASSWORD_RESET_V1_TOPIC,
  StaffAccountPasswordResetEventV1,
} from '../events/schemas/staff-account-password-reset.event';
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

export interface StaffAuditLogEntry {
  id: string;
  actorId: string;
  actorUsername: string;
  targetId: string;
  targetUsername: string;
  action: string;
  detail: unknown;
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
//
// GitHub issue #702 (Phase 51, D104) — every mutating method below now
// also publishes its matching staff.account.*.v1 event (#701's schemas),
// after StaffAuditLogService.record() commits, same best-effort/
// after-commit shape D16/D17/D53 already establish for every other
// domain-event publish in this codebase: a publish failure never affects
// (or even surfaces back to) the underlying write, which has already
// committed by the time it's attempted.
@Injectable()
export class StaffAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly staffAuditLog: StaffAuditLogService,
    private readonly domainEventPublisher: DomainEventPublisher,
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

  // GitHub issue #799 (Phase 54) — staff_audit_log was written on every
  // mutation in this service (StaffAuditLogService.record()) but had no
  // read endpoint anywhere, making the whole compliance trail invisible
  // to the admins it's meant to serve. Most recent first, capped — this
  // is an operational/compliance view, not a paginated archive; a real
  // "load more" is future scope if the cap ever matters in practice.
  async listAuditLog(limit = 200): Promise<StaffAuditLogEntry[]> {
    const entries = await this.prisma.staffAuditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        actor: { select: { username: true } },
        target: { select: { username: true } },
      },
    });

    return entries.map((entry) => ({
      id: entry.id,
      actorId: entry.actorId,
      actorUsername: entry.actor.username,
      targetId: entry.targetId,
      targetUsername: entry.target.username,
      action: entry.action,
      detail: entry.detail,
      createdAt: entry.createdAt,
    }));
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

    const event: StaffAccountCreatedEventV1 = {
      eventType: 'staff.account.created',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      moderatorId: created.id,
      email: created.email,
      role: created.role,
      actorId,
      temporaryPassword: password,
      actionId: randomUUID(),
    };
    await this.domainEventPublisher.publish(STAFF_ACCOUNT_CREATED_V1_TOPIC, event, created.id);

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
      select: { email: true, role: true, isActive: true, createdById: true },
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

    const event: StaffAccountRoleChangedEventV1 = {
      eventType: 'staff.account.role_changed',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      moderatorId: targetId,
      email: before.email,
      oldRole: before.role,
      newRole: role,
      actorId,
      actionId: randomUUID(),
    };
    await this.domainEventPublisher.publish(STAFF_ACCOUNT_ROLE_CHANGED_V1_TOPIC, event, targetId);

    return updated;
  }

  async deactivate(actorId: string, targetId: string): Promise<StaffAccountSummary> {
    const target = await this.prisma.moderator.findUniqueOrThrow({
      where: { id: targetId },
      select: { email: true, role: true, isActive: true, createdById: true },
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

    const event: StaffAccountDeactivatedEventV1 = {
      eventType: 'staff.account.deactivated',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      moderatorId: targetId,
      email: target.email,
      actorId,
      actionId: randomUUID(),
    };
    await this.domainEventPublisher.publish(STAFF_ACCOUNT_DEACTIVATED_V1_TOPIC, event, targetId);

    return updated;
  }

  async reactivate(actorId: string, targetId: string): Promise<StaffAccountSummary> {
    const target = await this.prisma.moderator.findUniqueOrThrow({
      where: { id: targetId },
      select: { email: true, createdById: true },
    });
    this.assertNotRoot(target);

    const updated = await this.prisma.moderator.update({
      where: { id: targetId },
      data: { isActive: true },
      select: STAFF_ACCOUNT_SELECT,
    });

    await this.staffAuditLog.record({ actorId, targetId, action: 'reactivated' });

    const event: StaffAccountReactivatedEventV1 = {
      eventType: 'staff.account.reactivated',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      moderatorId: targetId,
      email: target.email,
      actorId,
      actionId: randomUUID(),
    };
    await this.domainEventPublisher.publish(STAFF_ACCOUNT_REACTIVATED_V1_TOPIC, event, targetId);

    return updated;
  }

  async resetPassword(actorId: string, targetId: string): Promise<{ password: string }> {
    const target = await this.prisma.moderator.findUniqueOrThrow({
      where: { id: targetId },
      select: { email: true, createdById: true },
    });
    this.assertNotRoot(target);

    const password = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

    await this.prisma.moderator.update({ where: { id: targetId }, data: { passwordHash } });
    await this.staffAuditLog.record({ actorId, targetId, action: 'password_reset' });

    const event: StaffAccountPasswordResetEventV1 = {
      eventType: 'staff.account.password_reset',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      moderatorId: targetId,
      email: target.email,
      actorId,
      temporaryPassword: password,
      actionId: randomUUID(),
    };
    await this.domainEventPublisher.publish(STAFF_ACCOUNT_PASSWORD_RESET_V1_TOPIC, event, targetId);

    return { password };
  }
}
