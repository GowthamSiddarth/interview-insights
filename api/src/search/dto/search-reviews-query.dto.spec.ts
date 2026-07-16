import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { SearchReviewsQueryDto } from './search-reviews-query.dto';

describe('SearchReviewsQueryDto', () => {
  it('accepts an empty payload — every field is optional', async () => {
    const dto = plainToInstance(SearchReviewsQueryDto, {});
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts a fully populated payload', async () => {
    const dto = plainToInstance(SearchReviewsQueryDto, {
      q: 'fair',
      companyId: '123e4567-e89b-12d3-a456-426614174000',
      roleTitle: 'Engineer',
      roundType: 'coding',
      dateFrom: '2026-01-01',
      dateTo: '2026-02-01',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a non-UUID companyId', async () => {
    const dto = plainToInstance(SearchReviewsQueryDto, { companyId: 'not-a-uuid' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'companyId')).toBe(true);
  });

  it('rejects an invalid roundType', async () => {
    const dto = plainToInstance(SearchReviewsQueryDto, { roundType: 'trivia' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'roundType')).toBe(true);
  });

  it('rejects a malformed dateFrom/dateTo', async () => {
    const dto = plainToInstance(SearchReviewsQueryDto, { dateFrom: 'not-a-date' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'dateFrom')).toBe(true);
  });
});
