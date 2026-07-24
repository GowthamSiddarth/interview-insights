import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { CandidateSessionPayload } from './candidate-auth.service';

// Exported separately from the decorator itself so it's unit-testable
// without needing Nest's full decorator/execution-context machinery.
export function extractCurrentCandidateId(_data: unknown, ctx: ExecutionContext): string {
  const req = ctx.switchToHttp().getRequest<Request>();
  return (req.user as CandidateSessionPayload).candidateId;
}

// Resolves the authenticated candidate's id from the session — must be
// paired with CandidateJwtAuthGuard (which populates req.user), the same
// way admin-auth's routes cast req.user manually. GitHub issue #146:
// every write path derives candidateId from here, never from the
// request body, so a candidate can no longer submit as another.
export const CurrentCandidateId = createParamDecorator(extractCurrentCandidateId);
