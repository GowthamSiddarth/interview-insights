import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { RegisterCandidateDto } from './register-candidate.dto';

describe('RegisterCandidateDto', () => {
  it('accepts a valid email and a password of at least 12 characters', async () => {
    const dto = plainToInstance(RegisterCandidateDto, { email: 'candidate@example.com', password: 'a-strong-password' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a malformed email', async () => {
    const dto = plainToInstance(RegisterCandidateDto, { email: 'not-an-email', password: 'a-strong-password' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });

  it('rejects a password shorter than 12 characters', async () => {
    const dto = plainToInstance(RegisterCandidateDto, { email: 'candidate@example.com', password: 'short' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'password' && e.constraints?.minLength)).toBe(true);
  });

  it('rejects a missing password', async () => {
    const dto = plainToInstance(RegisterCandidateDto, { email: 'candidate@example.com' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'password')).toBe(true);
  });
});
