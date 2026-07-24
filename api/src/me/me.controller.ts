import { Controller, Delete, Get, HttpCode, HttpStatus, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { CANDIDATE_SESSION_HINT_COOKIE } from '../candidate-auth/candidate-auth.controller';
import { CandidateJwtAuthGuard } from '../candidate-auth/guards/candidate-jwt-auth.guard';
import { CurrentCandidateId } from '../candidate-auth/current-candidate.decorator';
import { CANDIDATE_SESSION_COOKIE } from '../candidate-auth/strategies/candidate-jwt.strategy';
import { getSessionCookieOptions } from '../common/session-cookie-options.util';
import { MeService } from './me.service';

@Controller('me')
export class MeController {
  constructor(private readonly meService: MeService) {}

  @Get('submissions')
  @UseGuards(CandidateJwtAuthGuard)
  findMySubmissions(@CurrentCandidateId() candidateId: string) {
    return this.meService.findMySubmissions(candidateId);
  }

  // GitHub issue #151 (GDPR erasure). Clears both session cookies the
  // same way POST /auth/logout does — the erased candidateId would fail
  // CandidateJwtStrategy's existence check on its very next use anyway,
  // but there's no reason to leave a now-meaningless cookie sitting in
  // the browser.
  @Delete()
  @UseGuards(CandidateJwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async eraseMe(
    @CurrentCandidateId() candidateId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.meService.eraseMe(candidateId);
    res.clearCookie(CANDIDATE_SESSION_COOKIE, getSessionCookieOptions());
    res.clearCookie(CANDIDATE_SESSION_HINT_COOKIE, {
      ...getSessionCookieOptions(),
      httpOnly: false,
    });
  }
}
