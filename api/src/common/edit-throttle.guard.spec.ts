import { ExecutionContext, HttpException } from '@nestjs/common';
import { EditThrottleGuard } from './edit-throttle.guard';
import { EditThrottleService } from './edit-throttle.service';

function contextWithCandidate(candidateId: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: { candidateId } }),
    }),
  } as unknown as ExecutionContext;
}

describe('EditThrottleGuard', () => {
  it('allows a request and records an attempt when not blocked', () => {
    const editThrottleService = {
      isBlocked: jest.fn().mockReturnValue(false),
      recordAttempt: jest.fn(),
    };
    const guard = new EditThrottleGuard(editThrottleService as unknown as EditThrottleService);

    const result = guard.canActivate(contextWithCandidate('candidate-1'));

    expect(result).toBe(true);
    expect(editThrottleService.recordAttempt).toHaveBeenCalledWith('candidate-1');
  });

  it('throws 429 and never records a further attempt when already blocked', () => {
    const editThrottleService = {
      isBlocked: jest.fn().mockReturnValue(true),
      recordAttempt: jest.fn(),
    };
    const guard = new EditThrottleGuard(editThrottleService as unknown as EditThrottleService);

    expect(() => guard.canActivate(contextWithCandidate('candidate-1'))).toThrow(HttpException);
    expect(editThrottleService.recordAttempt).not.toHaveBeenCalled();
  });
});
