import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { getRequiredCandidateJwtSecret } from '../candidate-auth.env';
import { CandidateSessionPayload } from '../candidate-auth.service';

export const CANDIDATE_SESSION_COOKIE = 'candidate_session';

function extractFromCookie(req: Request): string | null {
  return (req.cookies as Record<string, string> | undefined)?.[CANDIDATE_SESSION_COOKIE] ?? null;
}

// Named 'candidate-jwt' — distinct from admin-auth's 'admin-jwt' strategy
// name, and from passport-jwt's default 'jwt', so a future guard can't
// accidentally pick up the wrong session type.
@Injectable()
export class CandidateJwtStrategy extends PassportStrategy(Strategy, 'candidate-jwt') {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: extractFromCookie,
      secretOrKey: getRequiredCandidateJwtSecret(),
      ignoreExpiration: false,
    });
  }

  // GitHub issue #151 (Phase 17 kickoff brainstorm): sessions are
  // stateless JWTs with no server-side revocation, so a token issued
  // before `DELETE /me` erased the account would otherwise still verify
  // — then hit a downstream FK/not-found error on whatever write path
  // used it. Checking existence here turns that into a clean 401 at the
  // guard, before any route handler runs. One extra DB round trip per
  // authenticated request — an accepted trade-off, decided during the
  // brainstorm, not a performance oversight.
  async validate(payload: CandidateSessionPayload): Promise<CandidateSessionPayload> {
    const candidate = await this.prisma.candidate.findUnique({
      where: { id: payload.candidateId },
    });
    if (!candidate) {
      throw new UnauthorizedException();
    }
    // Narrowed back down to just the session payload, not whatever else
    // jwt.sign() adds (iat/exp) — same fix admin-auth's AdminJwtStrategy
    // needed once something (GET /auth/admin/me) actually read this value
    // end to end instead of only checking pass/fail.
    return { candidateId: payload.candidateId };
  }
}
