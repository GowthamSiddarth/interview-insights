import { CandidateJwtStrategy } from './candidate-jwt.strategy';

describe('CandidateJwtStrategy', () => {
  const originalSecret = process.env.CANDIDATE_JWT_SECRET;

  afterEach(() => {
    process.env.CANDIDATE_JWT_SECRET = originalSecret;
  });

  it('throws at construction if CANDIDATE_JWT_SECRET is not configured', () => {
    delete process.env.CANDIDATE_JWT_SECRET;
    expect(() => new CandidateJwtStrategy()).toThrow('CANDIDATE_JWT_SECRET');
  });

  it('passes the session payload through', () => {
    process.env.CANDIDATE_JWT_SECRET = 'test-secret';
    const strategy = new CandidateJwtStrategy();
    expect(strategy.validate({ candidateId: 'candidate-1' })).toEqual({
      candidateId: 'candidate-1',
    });
  });

  it('strips jwt.sign()-added claims like iat/exp, keeping only candidateId', () => {
    process.env.CANDIDATE_JWT_SECRET = 'test-secret';
    const strategy = new CandidateJwtStrategy();
    const decoded = { candidateId: 'candidate-1', iat: 1700000000, exp: 1700003600 };
    expect(strategy.validate(decoded)).toEqual({ candidateId: 'candidate-1' });
  });
});
