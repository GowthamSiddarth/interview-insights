import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

// GitHub issue #822 (Phase 57) — GET /companies ran an unbounded query,
// the same shape #415 already fixed for the sibling findTop() endpoint
// after a live complaint. Higher pageSize cap than
// ListCompanyReviewsQueryDto's 50 — companies grow far slower than
// reviews, and the one real consumer today (the moderation queue's
// company filter dropdown) wants "effectively all of them" in one call,
// not a paginated UI of its own.
export class ListCompaniesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number = 200;
}
