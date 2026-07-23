import { ExecutionContext, HttpException } from '@nestjs/common';
import { LoginThrottleGuard } from './login-throttle.guard';
import { LoginThrottleService } from './login-throttle.service';

function contextWithIp(ip: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ ip }),
    }),
  } as unknown as ExecutionContext;
}

describe('LoginThrottleGuard', () => {
  it('allows a request and records an attempt when not blocked', () => {
    const loginThrottleService = {
      isBlocked: jest.fn().mockReturnValue(false),
      recordAttempt: jest.fn(),
    };
    const guard = new LoginThrottleGuard(loginThrottleService as unknown as LoginThrottleService);

    const result = guard.canActivate(contextWithIp('1.2.3.4'));

    expect(result).toBe(true);
    expect(loginThrottleService.recordAttempt).toHaveBeenCalledWith('1.2.3.4');
  });

  it('throws 429 and never records a further attempt when already blocked', () => {
    const loginThrottleService = {
      isBlocked: jest.fn().mockReturnValue(true),
      recordAttempt: jest.fn(),
    };
    const guard = new LoginThrottleGuard(loginThrottleService as unknown as LoginThrottleService);

    expect(() => guard.canActivate(contextWithIp('1.2.3.4'))).toThrow(HttpException);
    expect(loginThrottleService.recordAttempt).not.toHaveBeenCalled();
  });
});
