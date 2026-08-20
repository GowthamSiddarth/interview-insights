import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ListCompaniesQueryDto } from './list-companies-query.dto';

describe('ListCompaniesQueryDto', () => {
  it('defaults page/pageSize when omitted', async () => {
    const dto = plainToInstance(ListCompaniesQueryDto, {});
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.pageSize).toBe(200);
  });

  it('coerces numeric strings (as query params arrive)', async () => {
    const dto = plainToInstance(ListCompaniesQueryDto, { page: '2', pageSize: '25' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.page).toBe(2);
    expect(dto.pageSize).toBe(25);
  });

  it.each([0, -1])('rejects page below 1: %i', async (page) => {
    const dto = plainToInstance(ListCompaniesQueryDto, { page });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'page')).toBe(true);
  });

  it('rejects pageSize above the cap', async () => {
    const dto = plainToInstance(ListCompaniesQueryDto, { pageSize: 201 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'pageSize')).toBe(true);
  });
});
