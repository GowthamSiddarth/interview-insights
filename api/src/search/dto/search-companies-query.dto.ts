import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

// GitHub issue #825 (Phase 57) — no size/from control previously; a
// broad query silently truncated to OpenSearch's implicit default (10
// hits) with no way to page further or even know more results existed.
export class SearchCompaniesQueryDto {
  @IsString()
  @IsNotEmpty()
  q!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  size?: number = 10;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  from?: number = 0;
}
