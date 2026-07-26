import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ModerationSearchQueryDto } from './moderation-search-query.dto';

describe('ModerationSearchQueryDto', () => {
  it('accepts an empty payload — both q and category are optional', async () => {
    const dto = plainToInstance(ModerationSearchQueryDto, {});
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts a q string alone', async () => {
    const dto = plainToInstance(ModerationSearchQueryDto, { q: 'acme' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts either valid category value', async () => {
    for (const category of ['interview-review', 'create-company']) {
      const dto = plainToInstance(ModerationSearchQueryDto, { category });
      expect(await validate(dto)).toHaveLength(0);
    }
  });

  it('rejects a category outside the two valid values', async () => {
    const dto = plainToInstance(ModerationSearchQueryDto, { category: 'something-else' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'category')).toBe(true);
  });
});
