import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateCandidateDto } from './create-candidate.dto';

describe('CreateCandidateDto', () => {
  it('accepts a valid email', async () => {
    const dto = plainToInstance(CreateCandidateDto, { email: 'candidate@example.com' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a malformed email', async () => {
    const dto = plainToInstance(CreateCandidateDto, { email: 'not-an-email' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('isEmail');
  });

  it('rejects a missing email', async () => {
    const dto = plainToInstance(CreateCandidateDto, {});
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
