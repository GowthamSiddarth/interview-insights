import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { Strategy } from 'passport-jwt';
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
  constructor() {
    super({
      jwtFromRequest: extractFromCookie,
      secretOrKey: getRequiredAdminEnv('ADMIN_JWT_SECRET'),
      ignoreExpiration: false,
    });
  }

  validate(payload: AdminSessionPayload): AdminSessionPayload {
    return payload;
  }
}
