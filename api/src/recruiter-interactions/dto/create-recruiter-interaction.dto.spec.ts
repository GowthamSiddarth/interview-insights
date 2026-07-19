import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateRecruiterInteractionDto } from './create-recruiter-interaction.dto';

describe('CreateRecruiterInteractionDto', () => {
  it('accepts a valid payload', async () => {
    const dto = plainToInstance(CreateRecruiterInteractionDto, {
      recruiterIdentifier: 'Jane Doe <jane@example.com>',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a missing recruiterIdentifier', async () => {
    const dto = plainToInstance(CreateRecruiterInteractionDto, {});
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'recruiterIdentifier')).toBe(true);
  });

  it('rejects an empty recruiterIdentifier', async () => {
    const dto = plainToInstance(CreateRecruiterInteractionDto, { recruiterIdentifier: '' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'recruiterIdentifier')).toBe(true);
  });
});