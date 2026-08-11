import { Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { StaffRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { getRequiredAdminEnv } from './admin-auth.env';
import { StaffAuditLogService } from './staff-audit-log.service';

const BCRYPT_COST = 10;

export interface AdminSessionPayload {
  id: string;
  username: string;
  role: StaffRole;
}

@Injectable()
export class AdminAuthService implements OnModuleInit {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly staffAuditLog: StaffAuditLogService,
  ) {}

  // GitHub issue #485 (Phase 36): replaces the single shared
  // ADMIN_USERNAME/ADMIN_PASSWORD_HASH credential with a real Moderator
  // row, so claim/reviewedBy can gain a real FK later (#486/#487) instead
  // of free text. Upserted on every boot, not just once — a fresh DB has
  // no rows to seed from, and rotating ADMIN_PASSWORD_HASH/ADMIN_EMAIL in
  // the secret store must keep taking effect immediately, same as when
  // validateAdmin() read those env vars directly (pre-#485). Fails fast
  // at boot like AdminAuthModule's own JwtModule.register() already does
  // for ADMIN_JWT_SECRET, rather than the lazy-throw-on-use pattern
  // getRequiredAdminEnv was originally built for — there's no per-request
  // read of these three left to defer the check to.
  //
  // GitHub issue #586 (Phase 42, D99): role: 'admin' is set explicitly on
  // both create and update so this boot-seeded identity is always the one
  // root ADMIN, regardless of what the `role` column's schema default
  // happens to be (it defaults to 'moderator' so pre-existing rows created
  // before this column existed stay valid without a data backfill). Also
  // always reactivates (isActive: true) — the root account is recovered via
  // credential rotation (infra/scripts/rotate-admin-credentials.sh), not
  // deactivate/reactivate tooling, so a stray deactivation should never be
  // able to permanently lock out the one account everything else bootstraps
  // from.
  async onModuleInit() {
    const username = getRequiredAdminEnv('ADMIN_USERNAME');
    const passwordHash = getRequiredAdminEnv('ADMIN_PASSWORD_HASH');
    const email = getRequiredAdminEnv('ADMIN_EMAIL');

    await this.prisma.moderator.upsert({
      where: { username },
      create: { username, passwordHash, email, role: 'admin', isActive: true },
      update: { passwordHash, email, role: 'admin', isActive: true },
    });
  }

  async validateAdmin(username: unknown, password: unknown): Promise<AdminSessionPayload | null> {
    // Defensive: passport-local's guard reads req.body directly and calls
    // this before Nest's ValidationPipe ever runs on the route's @Body()
    // parameter (guards execute before pipes), so a malformed body (e.g.
    // non-string fields) must be handled here, not assumed away by the DTO.
    if (typeof username !== 'string' || typeof password !== 'string') return null;

    const moderator = await this.prisma.moderator.findUnique({ where: { username } });
    if (!moderator) return null;

    const matches = await bcrypt.compare(password, moderator.passwordHash);
    if (!matches) return null;

    // GitHub issue #587 (Phase 42, D99): a deactivated account can never
    // log in, regardless of password correctness — checked after the
    // bcrypt.compare() above (not before) so this never becomes a timing
    // side-channel revealing whether a given username is deactivated vs.
    // simply having the wrong password.
    if (!moderator.isActive) return null;

    return { id: moderator.id, username: moderator.username, role: moderator.role };
  }

  issueToken(payload: AdminSessionPayload): string {
    return this.jwtService.sign(payload);
  }

  // GitHub issue #589 (Phase 42, D99) — self-service password change,
  // available to every role (no @RequirePermission() gate: this only ever
  // acts on the caller's own account, identified by their session, never a
  // client-supplied id). Requires the current password so a hijacked but
  // still-live session can't be used to silently lock the real owner out.
  async changeOwnPassword(staffId: string, currentPassword: string, newPassword: string): Promise<void> {
    const moderator = await this.prisma.moderator.findUniqueOrThrow({ where: { id: staffId } });

    const matches = await bcrypt.compare(currentPassword, moderator.passwordHash);
    if (!matches) {
      throw new UnauthorizedException('Current password is incorrect.');
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
    await this.prisma.moderator.update({ where: { id: staffId }, data: { passwordHash } });
    await this.staffAuditLog.record({
      actorId: staffId,
      targetId: staffId,
      action: 'password_reset',
    });
  }
}
