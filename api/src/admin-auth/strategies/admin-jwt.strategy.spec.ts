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

  it('passes the session payload through', () => {
    process.env.ADMIN_JWT_SECRET = 'test-secret';
    const strategy = new AdminJwtStrategy();
    expect(strategy.validate({ username: 'admin' })).toEqual({ username: 'admin' });
  });

  it('strips jwt.sign()-added claims like iat/exp, keeping only username', () => {
    process.env.ADMIN_JWT_SECRET = 'test-secret';
    const strategy = new AdminJwtStrategy();
    const decoded = { username: 'admin', iat: 1700000000, exp: 1700003600 };
    expect(strategy.validate(decoded)).toEqual({ username: 'admin' });
  });
});
