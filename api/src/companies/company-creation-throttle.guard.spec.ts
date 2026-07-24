import { ExecutionContext, HttpException } from '@nestjs/common';
import { CompanyCreationThrottleGuard } from './company-creation-throttle.guard';
import { CompanyCreationThrottleService } from './company-creation-throttle.service';

function contextWithIp(ip: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ ip }),
    }),
  } as unknown as ExecutionContext;
}

describe('CompanyCreationThrottleGuard', () => {
  it('allows a request and records an attempt when not blocked', () => {
    const companyCreationThrottleService = {
      isBlocked: jest.fn().mockReturnValue(false),
      recordAttempt: jest.fn(),
    };
    const guard = new CompanyCreationThrottleGuard(
      companyCreationThrottleService as unknown as CompanyCreationThrottleService,
    );

    expect(guard.canActivate(contextWithIp('1.2.3.4'))).toBe(true);
    expect(companyCreationThrottleService.recordAttempt).toHaveBeenCalledWith('1.2.3.4');
  });

  it('throws 429 and never records a further attempt when already blocked', () => {
    const companyCreationThrottleService = {
      isBlocked: jest.fn().mockReturnValue(true),
      recordAttempt: jest.fn(),
    };
    const guard = new CompanyCreationThrottleGuard(
      companyCreationThrottleService as unknown as CompanyCreationThrottleService,
    );

    expect(() => guard.canActivate(contextWithIp('1.2.3.4'))).toThrow(HttpException);
    expect(companyCreationThrottleService.recordAttempt).not.toHaveBeenCalled();
  });
});
