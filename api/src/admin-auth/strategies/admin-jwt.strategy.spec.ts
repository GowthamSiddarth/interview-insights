import { AdminJwtStrategy } from './admin-jwt.strategy';

describe('AdminJwtStrategy', () => {
  const originalSecret = process.env.ADMIN_JWT_SECRET;

  afterEach(() => {
    process.env.ADMIN_JWT_SECRET = originalSecret;
  });

  it('throws at construction if ADMIN_JWT_SECRET is not configured', () => {
    delete process.env.ADMIN_JWT_SECRET;
    expect(() => new AdminJwtStrategy()).toThrow('ADMIN_JWT_SECRET');
  });

  it('passes the decoded payload through unchanged', () => {
    process.env.ADMIN_JWT_SECRET = 'test-secret';
    const strategy = new AdminJwtStrategy();
    expect(strategy.validate({ username: 'admin' })).toEqual({ username: 'admin' });
  });
});
