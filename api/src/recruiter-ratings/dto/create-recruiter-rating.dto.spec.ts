import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateRecruiterRatingDto } from './create-recruiter-rating.dto';

const valid = {
  approachability: 4,
  responseTime: 3,
  timeliness: 5,
  communicationQuality: 4,
};

describe('CreateRecruiterRatingDto', () => {
  it('accepts a valid payload', async () => {
    const dto = plainToInstance(CreateRecruiterRatingDto, valid);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts optional freeText', async () => {
    const dto = plainToInstance(CreateRecruiterRatingDto, {
      ...valid,
      freeText: 'Very responsive throughout the process.',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([0, 6, -1])('rejects approachability out of 1-5 range: %i', async (approachability) => {
    const dto = plainToInstance(CreateRecruiterRatingDto, { ...valid, approachability });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'approachability')).toBe(true);
  });

  it('rejects a missing required rating field', async () => {
    const { timeliness: _timeliness, ...rest } = valid;
    const dto = plainToInstance(CreateRecruiterRatingDto, rest);
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'timeliness')).toBe(true);
  });
});
