import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { CompanyCreationThrottleService } from './company-creation-throttle.service';

// Mirrors candidate-auth/magic-link-throttle.guard.ts — runs after
// CandidateJwtAuthGuard (so an unauthenticated request 401s first,
// without ever touching this throttle's counter) but before the create()
// handler, so a throttled IP never triggers another database write.
@Injectable()
export class CompanyCreationThrottleGuard implements CanActivate {
  constructor(private readonly companyCreationThrottleService: CompanyCreationThrottleService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const ip = req.ip ?? 'unknown';
    if (this.companyCreationThrottleService.isBlocked(ip)) {
      throw new HttpException('Too many requests. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
    this.companyCreationThrottleService.recordAttempt(ip);
    return true;
  }
}
