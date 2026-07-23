import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { LoginThrottleService } from './login-throttle.service';

// Runs before AdminLocalAuthGuard in the login route's @UseGuards() list,
// so a throttled IP never reaches the bcrypt.compare() call — matters
// because bcrypt is deliberately slow, and letting an attacker keep
// triggering it is itself a (mild) DoS surface.
@Injectable()
export class LoginThrottleGuard implements CanActivate {
  constructor(private readonly loginThrottleService: LoginThrottleService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const ip = req.ip ?? 'unknown';
    if (this.loginThrottleService.isBlocked(ip)) {
      throw new HttpException('Too many login attempts. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
    this.loginThrottleService.recordAttempt(ip);
    return true;
  }
}
