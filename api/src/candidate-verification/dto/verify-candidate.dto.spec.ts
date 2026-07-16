import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { VerifyCandidateDto } from './verify-candidate.dto';

describe('VerifyCandidateDto', () => {
  it('accepts a non-empty token string', async () => {
    const dto = plainToInstance(VerifyCandidateDto, { token: 'abc123' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a missing token', async () => {
    const dto = plainToInstance(VerifyCandidateDto, {});
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'token')).toBe(true);
  });

  it('rejects an empty string token', async () => {
    const dto = plainToInstance(VerifyCandidateDto, { token: '' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'token')).toBe(true);
  });
});
