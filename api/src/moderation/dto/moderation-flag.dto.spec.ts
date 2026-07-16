import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ModerationFlagDto } from './moderation-flag.dto';

describe('ModerationFlagDto', () => {
  it('accepts an empty payload — flagReason is optional', async () => {
    const dto = plainToInstance(ModerationFlagDto, {});
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts a valid flagReason', async () => {
    const dto = plainToInstance(ModerationFlagDto, { flagReason: 'duplicate' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects an invalid flagReason', async () => {
    const dto = plainToInstance(ModerationFlagDto, { flagReason: 'not-a-real-reason' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'flagReason')).toBe(true);
  });
});
