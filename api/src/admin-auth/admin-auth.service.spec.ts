import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AdminAuthService } from './admin-auth.service';

describe('AdminAuthService', () => {
  let service: AdminAuthService;
  let jwtService: { sign: jest.Mock };
  const originalEnv = { ...process.env };
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await bcrypt.hash('correct-horse-battery-staple', 10);
  });

  beforeEach(async () => {
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD_HASH = passwordHash;

    jwtService = { sign: jest.fn().mockReturnValue('signed.jwt.token') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [AdminAuthService, { provide: JwtService, useValue: jwtService }],
    }).compile();

    service = module.get(AdminAuthService);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('validates correct credentials', async () => {
    const result = await service.validateAdmin('admin', 'correct-horse-battery-staple');
    expect(result).toEqual({ username: 'admin' });
  });

  it('rejects a wrong password', async () => {
    const result = await service.validateAdmin('admin', 'wrong-password');
    expect(result).toBeNull();
  });

  it('rejects a wrong username', async () => {
    const result = await service.validateAdmin('someone-else', 'correct-horse-battery-staple');
    expect(result).toBeNull();
  });

  it('rejects non-string credentials without throwing', async () => {
    await expect(service.validateAdmin(undefined, undefined)).resolves.toBeNull();
    await expect(service.validateAdmin(['admin'], 123)).resolves.toBeNull();
  });

  it('throws if ADMIN_USERNAME is not configured', async () => {
    delete process.env.ADMIN_USERNAME;
    await expect(service.validateAdmin('admin', 'correct-horse-battery-staple')).rejects.toThrow(
      'ADMIN_USERNAME',
    );
  });

  it('throws if ADMIN_PASSWORD_HASH is not configured', async () => {
    delete process.env.ADMIN_PASSWORD_HASH;
    await expect(service.validateAdmin('admin', 'correct-horse-battery-staple')).rejects.toThrow(
      'ADMIN_PASSWORD_HASH',
    );
  });

  it('signs a JWT with the session payload', () => {
    const token = service.issueToken({ username: 'admin' });
    expect(token).toBe('signed.jwt.token');
    expect(jwtService.sign).toHaveBeenCalledWith({ username: 'admin' });
  });
});
