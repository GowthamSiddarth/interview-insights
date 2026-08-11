import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { getSessionCookieOptions } from '../common/session-cookie-options.util';
import { AdminAuthService, AdminSessionPayload } from './admin-auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AdminJwtAuthGuard } from './guards/admin-jwt-auth.guard';
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
      ...getSessionCookieOptions(),
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
    res.clearCookie(ADMIN_SESSION_COOKIE, getSessionCookieOptions());
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

  // GitHub issue #589 (Phase 42, D99) — self-service password change,
  // available to every role. No PermissionsGuard: this only ever acts on
  // the caller's own account (req.user.id), never a client-supplied id, so
  // there's no permission tier to gate — every authenticated staff member
  // can already change their own password.
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminJwtAuthGuard)
  async changePassword(@Body() dto: ChangePasswordDto, @Req() req: Request) {
    const staff = req.user as AdminSessionPayload;
    await this.adminAuthService.changeOwnPassword(staff.id, dto.currentPassword, dto.newPassword);
    return { status: 'ok' };
  }
}
