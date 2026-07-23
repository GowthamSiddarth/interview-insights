import { ExecutionContext, HttpException } from '@nestjs/common';
import { MagicLinkThrottleGuard } from './magic-link-throttle.guard';
import { MagicLinkThrottleService } from './magic-link-throttle.service';

function contextWithIp(ip: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ ip }),
    }),
  } as unknown as ExecutionContext;
}

describe('MagicLinkThrottleGuard', () => {
  it('allows a request and records an attempt when not blocked', () => {
    const magicLinkThrottleService = {
      isBlocked: jest.fn().mockReturnValue(false),
      recordAttempt: jest.fn(),
    };
    const guard = new MagicLinkThrottleGuard(
      magicLinkThrottleService as unknown as MagicLinkThrottleService,
    );

    expect(guard.canActivate(contextWithIp('1.2.3.4'))).toBe(true);
    expect(magicLinkThrottleService.recordAttempt).toHaveBeenCalledWith('1.2.3.4');
  });

  it('throws 429 and never records a further attempt when already blocked', () => {
    const magicLinkThrottleService = {
      isBlocked: jest.fn().mockReturnValue(true),
      recordAttempt: jest.fn(),
    };
    const guard = new MagicLinkThrottleGuard(
      magicLinkThrottleService as unknown as MagicLinkThrottleService,
    );

    expect(() => guard.canActivate(contextWithIp('1.2.3.4'))).toThrow(HttpException);
    expect(magicLinkThrottleService.recordAttempt).not.toHaveBeenCalled();
  });
});
