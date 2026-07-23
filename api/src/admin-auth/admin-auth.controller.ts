import { Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { AdminAuthService, AdminSessionPayload } from './admin-auth.service';
import { AdminJwtAuthGuard } from './guards/admin-jwt-auth.guard';
import { AdminLocalAuthGuard } from './guards/admin-local-auth.guard';
import { LoginThrottleGuard } from './login-throttle.guard';
import { ADMIN_SESSION_COOKIE } from './strategies/admin-jwt.strategy';

const SESSION_MAX_AGE_MS = 60 * 60 * 1000; // 1h, matches JwtModule's signOptions.expiresIn

// Deliberately NOT `process.env.NODE_ENV === 'production'` — that was the
// bug. The api Docker image always sets NODE_ENV=production (that's just
// "this is the built image", not "this is served over HTTPS"), but every
// environment this project actually runs in today — local kind, the CD
// pipeline's dev/dev-localstack overlays — is plain HTTP with no TLS
// termination anywhere. A `Secure` cookie is silently refused by every
// browser over plain HTTP, so login "succeeded" (200, Set-Cookie present)
// but the browser never stored the cookie at all — the login page would
// just bounce straight back to itself with no visible error. Explicit
// opt-in env var instead, same pattern as SECRETS_SOURCE/CORS_ORIGIN;
// flip COOKIE_SECURE=true only once a real TLS-terminated environment
// exists (Phase 8/staging).
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: COOKIE_SECURE,
  sameSite: 'lax' as const,
};

@Controller('auth/admin')
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  // LoginThrottleGuard runs first (array order) so a throttled IP never
  // reaches AdminLocalAuthGuard's bcrypt.compare() call.
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(LoginThrottleGuard, AdminLocalAuthGuard)
  login(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    // AdminLocalAuthGuard already ran AdminLocalStrategy.validate() and
    // attached its result to req.user — never returned in the JSON body,
    // only as an httpOnly cookie (web never handles the raw token in JS).
    const admin = req.user as AdminSessionPayload;
    const token = this.adminAuthService.issueToken(admin);
    res.cookie(ADMIN_SESSION_COOKIE, token, {
      ...SESSION_COOKIE_OPTIONS,
      maxAge: SESSION_MAX_AGE_MS,
    });
    return { status: 'ok' };
  }

  // Unauthenticated on purpose: its only effect is clearing a cookie, and
  // gating it behind AdminJwtAuthGuard would make it fail exactly when
  // it's most useful (an already-expired session that can't clear itself).
  // Options must match how the cookie was set (secure/sameSite/httpOnly) —
  // a clearing Set-Cookie with mismatched attributes isn't guaranteed to
  // overwrite the original in every browser.
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(ADMIN_SESSION_COOKIE, SESSION_COOKIE_OPTIONS);
    return { status: 'ok' };
  }

  // Lightweight session check (GitHub issue #160): lets web's /moderation
  // page ask "am I logged in?" up front and redirect to the login page
  // before rendering anything, instead of rendering the queue and only
  // then discovering it via a failed 401 on the real data call.
  @Get('me')
  @UseGuards(AdminJwtAuthGuard)
  me(@Req() req: Request): AdminSessionPayload {
    return req.user as AdminSessionPayload;
  }
}
