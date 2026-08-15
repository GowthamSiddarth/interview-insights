import { ExecutionContext, HttpException } from '@nestjs/common';
import { PasswordResetThrottleGuard } from './password-reset-throttle.guard';
import { PasswordResetThrottleService } from './password-reset-throttle.service';

function contextWithIp(ip: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ ip }),
    }),
  } as unknown as ExecutionContext;
}

describe('PasswordResetThrottleGuard', () => {
  it('allows a request and records an attempt when not blocked', () => {
    const passwordResetThrottleService = {
      isBlocked: jest.fn().mockReturnValue(false),
      recordAttempt: jest.fn(),
    };
    const guard = new PasswordResetThrottleGuard(
      passwordResetThrottleService as unknown as PasswordResetThrottleService,
    );

    const result = guard.canActivate(contextWithIp('1.2.3.4'));

    expect(result).toBe(true);
    expect(passwordResetThrottleService.recordAttempt).toHaveBeenCalledWith('1.2.3.4');
  });

  it('throws 429 and never records a further attempt when already blocked', () => {
    const passwordResetThrottleService = {
      isBlocked: jest.fn().mockReturnValue(true),
      recordAttempt: jest.fn(),
    };
    const guard = new PasswordResetThrottleGuard(
      passwordResetThrottleService as unknown as PasswordResetThrottleService,
    );

    expect(() => guard.canActivate(contextWithIp('1.2.3.4'))).toThrow(HttpException);
    expect(passwordResetThrottleService.recordAttempt).not.toHaveBeenCalled();
  });
});
