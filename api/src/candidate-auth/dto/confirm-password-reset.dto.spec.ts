import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ConfirmPasswordResetDto } from './confirm-password-reset.dto';

describe('ConfirmPasswordResetDto', () => {
  it('accepts a token and a password of at least 12 characters', async () => {
    const dto = plainToInstance(ConfirmPasswordResetDto, { token: 'abc123', newPassword: 'a-strong-password' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a password shorter than 12 characters', async () => {
    const dto = plainToInstance(ConfirmPasswordResetDto, { token: 'abc123', newPassword: 'short' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'newPassword' && e.constraints?.minLength)).toBe(true);
  });

  it('rejects a missing token', async () => {
    const dto = plainToInstance(ConfirmPasswordResetDto, { newPassword: 'a-strong-password' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'token')).toBe(true);
  });
});
