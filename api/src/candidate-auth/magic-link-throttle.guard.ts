import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { MagicLinkThrottleService } from './magic-link-throttle.service';

// Mirrors admin-auth/login-throttle.guard.ts — runs before the
// request-link handler so a throttled IP never triggers another
// outbound email or database upsert.
@Injectable()
export class MagicLinkThrottleGuard implements CanActivate {
  constructor(private readonly magicLinkThrottleService: MagicLinkThrottleService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const ip = req.ip ?? 'unknown';
    if (this.magicLinkThrottleService.isBlocked(ip)) {
      throw new HttpException('Too many requests. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
    this.magicLinkThrottleService.recordAttempt(ip);
    return true;
  }
}
