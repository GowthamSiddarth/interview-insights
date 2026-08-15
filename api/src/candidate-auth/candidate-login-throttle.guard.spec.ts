import { ExecutionContext, HttpException } from '@nestjs/common';
import { CandidateLoginThrottleGuard } from './candidate-login-throttle.guard';
import { CandidateLoginThrottleService } from './candidate-login-throttle.service';

function contextWithIp(ip: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ ip }),
    }),
  } as unknown as ExecutionContext;
}

describe('CandidateLoginThrottleGuard', () => {
  it('allows a request and records an attempt when not blocked', () => {
    const candidateLoginThrottleService = {
      isBlocked: jest.fn().mockReturnValue(false),
      recordAttempt: jest.fn(),
    };
    const guard = new CandidateLoginThrottleGuard(
      candidateLoginThrottleService as unknown as CandidateLoginThrottleService,
    );

    const result = guard.canActivate(contextWithIp('1.2.3.4'));

    expect(result).toBe(true);
    expect(candidateLoginThrottleService.recordAttempt).toHaveBeenCalledWith('1.2.3.4');
  });

  it('throws 429 and never records a further attempt when already blocked', () => {
    const candidateLoginThrottleService = {
      isBlocked: jest.fn().mockReturnValue(true),
      recordAttempt: jest.fn(),
    };
    const guard = new CandidateLoginThrottleGuard(
      candidateLoginThrottleService as unknown as CandidateLoginThrottleService,
    );

    expect(() => guard.canActivate(contextWithIp('1.2.3.4'))).toThrow(HttpException);
    expect(candidateLoginThrottleService.recordAttempt).not.toHaveBeenCalled();
  });
});
