import { Injectable } from '@nestjs/common';
import { Prisma, StaffAuditAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface RecordStaffAuditParams {
  actorId: string;
  targetId: string;
  action: StaffAuditAction;
  detail?: Prisma.InputJsonValue;
}

// GitHub issue #586/#589 (Phase 42, D99) — every admin action against a
// staff account is durably recorded, never best-effort, same precedent
// AiAutoApprovalAudit (D71) sets for system-attributed decisions.
// actorId === targetId for a self-service password change (AdminAuthService
// .changeOwnPassword), distinct for anything an admin does to another
// account (StaffAccountsService).
@Injectable()
export class StaffAuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async record(params: RecordStaffAuditParams): Promise<void> {
    await this.prisma.staffAuditLog.create({ data: params });
  }
}
