import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ModerationActionDto } from './moderation-action.dto';

describe('ModerationActionDto', () => {
  it('accepts an empty payload — reviewedBy is optional', async () => {
    const dto = plainToInstance(ModerationActionDto, {});
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts a string reviewedBy', async () => {
    const dto = plainToInstance(ModerationActionDto, { reviewedBy: 'gowtham' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a non-string reviewedBy', async () => {
    const dto = plainToInstance(ModerationActionDto, { reviewedBy: 42 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'reviewedBy')).toBe(true);
  });
});
