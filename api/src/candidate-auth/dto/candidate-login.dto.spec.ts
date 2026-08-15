import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CandidateLoginDto } from './candidate-login.dto';

describe('CandidateLoginDto', () => {
  it('accepts a valid email and a non-empty password', async () => {
    const dto = plainToInstance(CandidateLoginDto, { email: 'candidate@example.com', password: 'whatever' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a malformed email', async () => {
    const dto = plainToInstance(CandidateLoginDto, { email: 'not-an-email', password: 'whatever' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });

  it('rejects an empty password', async () => {
    const dto = plainToInstance(CandidateLoginDto, { email: 'candidate@example.com', password: '' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'password')).toBe(true);
  });
});
