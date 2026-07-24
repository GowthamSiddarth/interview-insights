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
@Injectable()
export class EditThrottleGuard implements CanActivate {
  constructor(private readonly editThrottleService: EditThrottleService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const candidateId = (req.user as SessionWithCandidateId).candidateId;
    if (this.editThrottleService.isBlocked(candidateId)) {
      throw new HttpException('Too many edits. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
    this.editThrottleService.recordAttempt(candidateId);
    return true;
  }
}
