import { Controller, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { AdminAuthService, AdminSessionPayload } from './admin-auth.service';
import { AdminLocalAuthGuard } from './guards/admin-local-auth.guard';
import { LoginThrottleGuard } from './login-throttle.guard';
import { ADMIN_SESSION_COOKIE } from './strategies/admin-jwt.strategy';

const SESSION_MAX_AGE_MS = 60 * 60 * 1000; // 1h, matches JwtModule's signOptions.expiresIn

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
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE_MS,
    });
    return { status: 'ok' };
  }

  // Unauthenticated on purpose: its only effect is clearing a cookie, and
  // gating it behind AdminJwtAuthGuard would make it fail exactly when
  // it's most useful (an already-expired session that can't clear itself).
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(ADMIN_SESSION_COOKIE);
    return { status: 'ok' };
  }
}
