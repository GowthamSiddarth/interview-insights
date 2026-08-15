import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { getSessionCookieOptions } from '../common/session-cookie-options.util';
import { CandidateAuthService, CandidateSessionPayload } from './candidate-auth.service';
import { RegisterCandidateDto } from './dto/register-candidate.dto';
import { RequestLinkDto } from './dto/request-link.dto';
import { VerifyMagicLinkDto } from './dto/verify-magic-link.dto';
import { CandidateJwtAuthGuard } from './guards/candidate-jwt-auth.guard';
import { MagicLinkThrottleGuard } from './magic-link-throttle.guard';
import { CANDIDATE_SESSION_COOKIE } from './strategies/candidate-jwt.strategy';

const SESSION_MAX_AGE_MS = 60 * 60 * 1000; // 1h, matches JwtModule's signOptions.expiresIn

// A plain, non-httpOnly companion to CANDIDATE_SESSION_COOKIE — carries no
// secret, just a hint web's NavBar (rendered on every page, for every
// anonymous visitor too) can read synchronously via document.cookie to
// decide whether to call GET /auth/me at all. Without it, every single
// anonymous page view would issue a doomed-to-401 fetch purely to render
// "Log in" — harmless functionally, but the browser logs that as a console
// error on every page, defeating the "zero console errors" verification
// bar for what's actually the platform's single most common page view.
// Set/cleared in lockstep with the real session cookie.
export const CANDIDATE_SESSION_HINT_COOKIE = 'candidate_logged_in';

@Controller('auth')
export class CandidateAuthController {
  constructor(private readonly candidateAuthService: CandidateAuthService) {}

  // Rate-limited (GitHub issue #145's brainstorm) — a new public endpoint
  // accepting an email is a spam/abuse surface the moment it exists.
  // Always returns the same shape regardless of whether the email was
  // known — CandidateAuthService.requestLink() never throws on an
  // unknown email, so this can't be used to enumerate accounts.
  @Post('request-link')
  @HttpCode(HttpStatus.OK)
  @UseGuards(MagicLinkThrottleGuard)
  async requestLink(@Body() dto: RequestLinkDto) {
    await this.candidateAuthService.requestLink(dto.email);
    return { status: 'ok' };
  }

  // GET (a clicked email link is a browser navigation) and POST (a
  // same-origin fetch from the verify-landing page, issue #147) both
  // supported — same underlying consume-and-issue-session logic.
  @Get('verify')
  async verifyByQuery(@Query() dto: VerifyMagicLinkDto, @Res({ passthrough: true }) res: Response) {
    return this.verify(dto.token, res);
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verifyByBody(@Body() dto: VerifyMagicLinkDto, @Res({ passthrough: true }) res: Response) {
    return this.verify(dto.token, res);
  }

  private async verify(token: string, res: Response) {
    const session = await this.candidateAuthService.verify(token);
    this.issueSession(session, res);
    return { status: 'ok' };
  }

  // GitHub issue #680 (Phase 48, D104) — password registration.
  // Auto-issues a session on success, same as magic-link verify() —
  // the freshly set password is already proof of possession, and this
  // project has no existing write path that gates on
  // verificationStatus, so there's no reason to make the candidate wait
  // on the verification email before they can use the account. The
  // email itself is still sent (best-effort, inside the service) as a
  // trust signal, not a login gate.
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterCandidateDto, @Res({ passthrough: true }) res: Response) {
    const session = await this.candidateAuthService.register(dto.email, dto.password);
    this.issueSession(session, res);
    return { status: 'ok' };
  }

  private issueSession(session: CandidateSessionPayload, res: Response): void {
    const jwt = this.candidateAuthService.issueToken(session);
    res.cookie(CANDIDATE_SESSION_COOKIE, jwt, {
      ...getSessionCookieOptions(),
      maxAge: SESSION_MAX_AGE_MS,
    });
    res.cookie(CANDIDATE_SESSION_HINT_COOKIE, '1', {
      ...getSessionCookieOptions(),
      httpOnly: false,
      maxAge: SESSION_MAX_AGE_MS,
    });
  }

  // Options must match how the cookie was set — a clearing Set-Cookie
  // with mismatched attributes isn't guaranteed to overwrite the
  // original in every browser (same note as admin-auth's logout).
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(CANDIDATE_SESSION_COOKIE, getSessionCookieOptions());
    res.clearCookie(CANDIDATE_SESSION_HINT_COOKIE, {
      ...getSessionCookieOptions(),
      httpOnly: false,
    });
    return { status: 'ok' };
  }

  // Lightweight session check (GitHub issue #147, mirroring admin-auth's
  // GET /auth/admin/me from issue #160): lets web's NavBar and the wizard
  // ask "am I logged in?" up front, before rendering the email-collection
  // step or an inline login prompt.
  @Get('me')
  @UseGuards(CandidateJwtAuthGuard)
  me(@Req() req: Request): CandidateSessionPayload {
    return req.user as CandidateSessionPayload;
  }
}
