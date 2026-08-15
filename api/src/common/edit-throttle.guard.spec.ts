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
  it('allows a request when the throttle service allows the attempt', async () => {
    const editThrottleService = {
      recordAttemptIfAllowed: jest.fn().mockResolvedValue(true),
    };
    const guard = new EditThrottleGuard(editThrottleService as unknown as EditThrottleService);

    const result = await guard.canActivate(contextWithCandidate('candidate-1'));

    expect(result).toBe(true);
    expect(editThrottleService.recordAttemptIfAllowed).toHaveBeenCalledWith('candidate-1');
  });

  it('throws 429 when the throttle service blocks the attempt', async () => {
    const editThrottleService = {
      recordAttemptIfAllowed: jest.fn().mockResolvedValue(false),
    };
    const guard = new EditThrottleGuard(editThrottleService as unknown as EditThrottleService);

    await expect(guard.canActivate(contextWithCandidate('candidate-1'))).rejects.toThrow(HttpException);
  });
});
