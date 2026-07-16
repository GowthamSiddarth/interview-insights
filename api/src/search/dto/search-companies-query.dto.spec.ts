import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { SearchCompaniesQueryDto } from './search-companies-query.dto';

describe('SearchCompaniesQueryDto', () => {
  it('accepts a non-empty query string', async () => {
    const dto = plainToInstance(SearchCompaniesQueryDto, { q: 'acme' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a missing query', async () => {
    const dto = plainToInstance(SearchCompaniesQueryDto, {});
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'q')).toBe(true);
  });

  it('rejects an empty query string', async () => {
    const dto = plainToInstance(SearchCompaniesQueryDto, { q: '' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'q')).toBe(true);
  });
});
