// class-transformer's @Type() decorator (size/from below, GitHub issue
// #825) needs reflect-metadata, which Nest's bootstrap imports globally —
// a bare DTO unit test must do it itself.
import 'reflect-metadata';
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

  // GitHub issue #825 (Phase 57).
  it('defaults size/from when omitted', async () => {
    const dto = plainToInstance(SearchCompaniesQueryDto, { q: 'acme' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.size).toBe(10);
    expect(dto.from).toBe(0);
  });

  it('coerces numeric strings (as query params arrive)', async () => {
    const dto = plainToInstance(SearchCompaniesQueryDto, { q: 'acme', size: '25', from: '50' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.size).toBe(25);
    expect(dto.from).toBe(50);
  });

  it('rejects size above the cap', async () => {
    const dto = plainToInstance(SearchCompaniesQueryDto, { q: 'acme', size: 51 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'size')).toBe(true);
  });

  it('rejects a negative from', async () => {
    const dto = plainToInstance(SearchCompaniesQueryDto, { q: 'acme', from: -1 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'from')).toBe(true);
  });
});
