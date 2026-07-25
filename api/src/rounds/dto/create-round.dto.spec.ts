import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateRoundDto } from './create-round.dto';

const valid = {
  sequenceNumber: 1,
  title: 'Technical Screen',
  roundType: 'coding',
};

describe('CreateRoundDto', () => {
  it('accepts a valid payload', async () => {
    const dto = plainToInstance(CreateRoundDto, valid);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts optional description/scheduledDurationMinutes/typeMetadata', async () => {
    const dto = plainToInstance(CreateRoundDto, {
      ...valid,
      description: 'Live coding on CoderPad',
      scheduledDurationMinutes: 60,
      typeMetadata: { language_used: 'Python', platform: 'CoderPad' },
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects sequenceNumber below 1', async () => {
    const dto = plainToInstance(CreateRoundDto, { ...valid, sequenceNumber: 0 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'sequenceNumber')).toBe(true);
  });

  it('rejects an invalid roundType', async () => {
    const dto = plainToInstance(CreateRoundDto, { ...valid, roundType: 'trivia' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'roundType')).toBe(true);
  });

  it('accepts a missing title (GitHub issue #287 — optional)', async () => {
    const { title: _title, ...rest } = valid;
    const dto = plainToInstance(CreateRoundDto, rest);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a non-string title', async () => {
    const dto = plainToInstance(CreateRoundDto, { ...valid, title: 123 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'title')).toBe(true);
  });
});
