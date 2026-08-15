import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { RequestPasswordResetDto } from './request-password-reset.dto';

describe('RequestPasswordResetDto', () => {
  it('accepts a valid email', async () => {
    const dto = plainToInstance(RequestPasswordResetDto, { email: 'candidate@example.com' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a malformed email', async () => {
    const dto = plainToInstance(RequestPasswordResetDto, { email: 'not-an-email' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
