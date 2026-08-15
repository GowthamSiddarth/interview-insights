import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { CandidateLoginThrottleService } from './candidate-login-throttle.service';

// Mirrors admin-auth/login-throttle.guard.ts — runs before the login
// handler's own bcrypt.compare() call, same "don't let a throttled IP
// trigger the slow hash comparison" reasoning.
@Injectable()
export class CandidateLoginThrottleGuard implements CanActivate {
  constructor(private readonly candidateLoginThrottleService: CandidateLoginThrottleService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const ip = req.ip ?? 'unknown';
    if (this.candidateLoginThrottleService.isBlocked(ip)) {
      throw new HttpException('Too many login attempts. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
    this.candidateLoginThrottleService.recordAttempt(ip);
    return true;
  }
}
