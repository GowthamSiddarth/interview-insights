// class-transformer's @Type() decorator needs reflect-metadata, which
// Nest's bootstrap imports globally — a bare DTO unit test must do it
// itself (first DTO in the codebase to use @Type()).
import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ListCompanyReviewsQueryDto } from './list-company-reviews-query.dto';

describe('ListCompanyReviewsQueryDto', () => {
  it('defaults page/pageSize when omitted', async () => {
    const dto = plainToInstance(ListCompanyReviewsQueryDto, {});
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.pageSize).toBe(10);
  });

  it('coerces numeric strings (as query params arrive)', async () => {
    const dto = plainToInstance(ListCompanyReviewsQueryDto, { page: '2', pageSize: '25' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.page).toBe(2);
    expect(dto.pageSize).toBe(25);
  });

  it.each([0, -1])('rejects page below 1: %i', async (page) => {
    const dto = plainToInstance(ListCompanyReviewsQueryDto, { page });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'page')).toBe(true);
  });

  it('rejects pageSize above the cap', async () => {
    const dto = plainToInstance(ListCompanyReviewsQueryDto, { pageSize: 51 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'pageSize')).toBe(true);
  });
});
