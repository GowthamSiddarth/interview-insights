import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { getSessionCookieOptions } from '../common/session-cookie-options.util';
import { CandidateAuthService } from './candidate-auth.service';
import { RequestLinkDto } from './dto/request-link.dto';
import { VerifyMagicLinkDto } from './dto/verify-magic-link.dto';
import { MagicLinkThrottleGuard } from './magic-link-throttle.guard';
import { CANDIDATE_SESSION_COOKIE } from './strategies/candidate-jwt.strategy';

const SESSION_MAX_AGE_MS = 60 * 60 * 1000; // 1h, matches JwtModule's signOptions.expiresIn

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
    const jwt = this.candidateAuthService.issueToken(session);
    res.cookie(CANDIDATE_SESSION_COOKIE, jwt, {
      ...getSessionCookieOptions(),
      maxAge: SESSION_MAX_AGE_MS,
    });
    return { status: 'ok' };
  }

  // Options must match how the cookie was set — a clearing Set-Cookie
  // with mismatched attributes isn't guaranteed to overwrite the
  // original in every browser (same note as admin-auth's logout).
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(CANDIDATE_SESSION_COOKIE, getSessionCookieOptions());
    return { status: 'ok' };
  }
}
