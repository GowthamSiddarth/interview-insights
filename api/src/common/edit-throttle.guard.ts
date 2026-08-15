import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { EditThrottleService } from './edit-throttle.service';

interface SessionWithCandidateId {
  candidateId: string;
}

// Must run after CandidateJwtAuthGuard in a route's @UseGuards() list
// (e.g. @UseGuards(CandidateJwtAuthGuard, EditThrottleGuard)) so
// req.user.candidateId is already populated — same guard-ordering
// pattern as LoginThrottleGuard/MagicLinkThrottleGuard, keyed by
// candidateId instead of IP since the abuse surface here is a single
// authenticated candidate editing their own content repeatedly, not an
// anonymous caller.
//
// GitHub issue #693 (Phase 49, D104) — async now that
// EditThrottleService.recordAttemptIfAllowed() is a Postgres call, not an
// in-memory Map lookup; Nest's CanActivate already supports a Promise
// return, so no other wiring changes.
@Injectable()
export class EditThrottleGuard implements CanActivate {
  constructor(private readonly editThrottleService: EditThrottleService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const candidateId = (req.user as SessionWithCandidateId).candidateId;
    const allowed = await this.editThrottleService.recordAttemptIfAllowed(candidateId);
    if (!allowed) {
      throw new HttpException('Too many edits. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}
