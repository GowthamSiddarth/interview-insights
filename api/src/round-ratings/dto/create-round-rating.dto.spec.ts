import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateRoundRatingDto } from './create-round-rating.dto';

const valid = {
  difficulty: 3,
  fairness: 4,
  communicationFluency: 5,
  attentiveness: 4,
  biasSignal: 5,
};

describe('CreateRoundRatingDto', () => {
  it('accepts a valid payload', async () => {
    const dto = plainToInstance(CreateRoundRatingDto, valid);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts optional technicalDepth and freeText', async () => {
    const dto = plainToInstance(CreateRoundRatingDto, {
      ...valid,
      technicalDepth: 2,
      freeText: 'Interviewer was late but the questions were fair.',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([0, 6, -1])('rejects difficulty out of 1-5 range: %i', async (difficulty) => {
    const dto = plainToInstance(CreateRoundRatingDto, { ...valid, difficulty });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'difficulty')).toBe(true);
  });

  it('rejects technicalDepth out of 1-5 range when provided', async () => {
    const dto = plainToInstance(CreateRoundRatingDto, { ...valid, technicalDepth: 6 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'technicalDepth')).toBe(true);
  });

  it('rejects a missing required rating field', async () => {
    const { biasSignal: _biasSignal, ...rest } = valid;
    const dto = plainToInstance(CreateRoundRatingDto, rest);
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'biasSignal')).toBe(true);
  });
});
