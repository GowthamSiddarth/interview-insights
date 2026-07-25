import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateRecruiterRatingDto } from './create-recruiter-rating.dto';

const valid = {
  reachability: 4,
  responsiveness: 3,
  guidelinesShared: 5,
};

describe('CreateRecruiterRatingDto', () => {
  it('accepts a valid payload', async () => {
    const dto = plainToInstance(CreateRecruiterRatingDto, valid);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts optional freeText and rejectionMessageAuthenticity', async () => {
    const dto = plainToInstance(CreateRecruiterRatingDto, {
      ...valid,
      rejectionMessageAuthenticity: 2,
      freeText: 'Very responsive throughout the process.',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts a payload with rejectionMessageAuthenticity omitted', async () => {
    const dto = plainToInstance(CreateRecruiterRatingDto, valid);
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([0, 6, -1])('rejects reachability out of 1-5 range: %i', async (reachability) => {
    const dto = plainToInstance(CreateRecruiterRatingDto, { ...valid, reachability });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'reachability')).toBe(true);
  });

  it.each([0, 6, -1])(
    'rejects rejectionMessageAuthenticity out of 1-5 range when provided: %i',
    async (rejectionMessageAuthenticity) => {
      const dto = plainToInstance(CreateRecruiterRatingDto, {
        ...valid,
        rejectionMessageAuthenticity,
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'rejectionMessageAuthenticity')).toBe(true);
    },
  );

  it('rejects a missing required rating field', async () => {
    const { guidelinesShared: _guidelinesShared, ...rest } = valid;
    const dto = plainToInstance(CreateRecruiterRatingDto, rest);
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'guidelinesShared')).toBe(true);
  });
});
