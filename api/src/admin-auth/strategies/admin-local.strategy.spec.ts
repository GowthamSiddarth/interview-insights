import { UnauthorizedException } from '@nestjs/common';
import { AdminLocalStrategy } from './admin-local.strategy';
import { AdminAuthService } from '../admin-auth.service';

describe('AdminLocalStrategy', () => {
  it('returns the session payload on valid credentials', async () => {
    const adminAuthService = { validateAdmin: jest.fn().mockResolvedValue({ username: 'admin' }) };
    const strategy = new AdminLocalStrategy(adminAuthService as unknown as AdminAuthService);

    await expect(strategy.validate('admin', 'correct-password')).resolves.toEqual({
      username: 'admin',
    });
  });

  it('throws UnauthorizedException on invalid credentials', async () => {
    const adminAuthService = { validateAdmin: jest.fn().mockResolvedValue(null) };
    const strategy = new AdminLocalStrategy(adminAuthService as unknown as AdminAuthService);

    await expect(strategy.validate('admin', 'wrong-password')).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
