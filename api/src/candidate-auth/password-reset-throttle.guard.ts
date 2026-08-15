import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { PasswordResetThrottleService } from './password-reset-throttle.service';

// Mirrors magic-link-throttle.guard.ts / candidate-login-throttle.guard.ts
// — runs before the request-password-reset handler so a throttled IP
// never triggers another outbound email or database write.
@Injectable()
export class PasswordResetThrottleGuard implements CanActivate {
  constructor(private readonly passwordResetThrottleService: PasswordResetThrottleService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const ip = req.ip ?? 'unknown';
    if (this.passwordResetThrottleService.isBlocked(ip)) {
      throw new HttpException('Too many requests. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
    this.passwordResetThrottleService.recordAttempt(ip);
    return true;
  }
}
