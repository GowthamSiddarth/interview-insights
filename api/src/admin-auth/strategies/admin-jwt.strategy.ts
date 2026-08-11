import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { getRequiredAdminEnv } from '../admin-auth.env';
import { AdminSessionPayload } from '../admin-auth.service';

export const ADMIN_SESSION_COOKIE = 'admin_session';

function extractFromCookie(req: Request): string | null {
  return (req.cookies as Record<string, string> | undefined)?.[ADMIN_SESSION_COOKIE] ?? null;
}

// Named 'admin-jwt' so ModerationController's guard can't accidentally
// pick up some future unrelated JWT strategy registered under the
// passport-jwt default 'jwt' name.
@Injectable()
export class AdminJwtStrategy extends PassportStrategy(Strategy, 'admin-jwt') {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: extractFromCookie,
      secretOrKey: getRequiredAdminEnv('ADMIN_JWT_SECRET'),
      ignoreExpiration: false,
    });
  }

  // GitHub issue #587 (Phase 42, D99): re-reads role/isActive from the DB
  // on every request rather than trusting the JWT's own claims for
  // anything but identity (payload.id) — a deactivation or role change
  // must take effect on the account's very next request, not wait up to
  // the token's full 1h expiry. This is the one extra query per
  // authenticated admin/moderator/staff request the permission-set model
  // costs; acceptable here since this is a low-traffic internal surface,
  // not a public hot path. username is still taken from the payload
  // (unique + immutable, no self-service rename exists) purely to avoid a
  // second lookup already-fetched by id.
  async validate(payload: AdminSessionPayload): Promise<AdminSessionPayload> {
    const moderator = await this.prisma.moderator.findUnique({ where: { id: payload.id } });
    if (!moderator || !moderator.isActive) {
      throw new UnauthorizedException('Session is no longer valid.');
    }
    return { id: moderator.id, username: moderator.username, role: moderator.role };
  }
}
