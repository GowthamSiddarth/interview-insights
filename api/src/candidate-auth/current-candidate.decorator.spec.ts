import { ExecutionContext } from '@nestjs/common';
import { extractCurrentCandidateId } from './current-candidate.decorator';

function contextWithUser(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('extractCurrentCandidateId', () => {
  it('returns candidateId from req.user', () => {
    const ctx = contextWithUser({ candidateId: 'candidate-1' });
    expect(extractCurrentCandidateId(undefined, ctx)).toBe('candidate-1');
  });
});
