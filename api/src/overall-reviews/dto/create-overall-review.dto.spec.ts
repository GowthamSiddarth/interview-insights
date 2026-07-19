import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateOverallReviewDto } from './create-overall-review.dto';

const valid = {
  candidateId: '123e4567-e89b-12d3-a456-426614174000',
  overallExperience: 4,
  wouldRecommend: true,
};

describe('CreateOverallReviewDto', () => {
  it('accepts a valid payload', async () => {
    const dto = plainToInstance(CreateOverallReviewDto, valid);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts optional reviewText', async () => {
    const dto = plainToInstance(CreateOverallReviewDto, {
      ...valid,
      reviewText: 'Well-organized process end to end.',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([0, 6, -1])('rejects overallExperience out of 1-5 range: %i', async (overallExperience) => {
    const dto = plainToInstance(CreateOverallReviewDto, { ...valid, overallExperience });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'overallExperience')).toBe(true);
  });

  it('rejects a non-boolean wouldRecommend', async () => {
    const dto = plainToInstance(CreateOverallReviewDto, { ...valid, wouldRecommend: 'yes' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'wouldRecommend')).toBe(true);
  });

  it('rejects a missing wouldRecommend', async () => {
    const { wouldRecommend: _wouldRecommend, ...rest } = valid;
    const dto = plainToInstance(CreateOverallReviewDto, rest);
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'wouldRecommend')).toBe(true);
  });

  it('rejects a non-UUID candidateId', async () => {
    const dto = plainToInstance(CreateOverallReviewDto, { ...valid, candidateId: 'nope' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'candidateId')).toBe(true);
  });
});
