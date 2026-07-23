import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { Strategy } from 'passport-jwt';
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
  constructor() {
    super({
      jwtFromRequest: extractFromCookie,
      secretOrKey: getRequiredCandidateJwtSecret(),
      ignoreExpiration: false,
    });
  }

  // Narrowed back down to just the session payload, not whatever else
  // jwt.sign() adds (iat/exp) — same fix admin-auth's AdminJwtStrategy
  // needed once something (GET /auth/admin/me) actually read this value
  // end to end instead of only checking pass/fail.
  validate(payload: CandidateSessionPayload): CandidateSessionPayload {
    return { candidateId: payload.candidateId };
  }
}
