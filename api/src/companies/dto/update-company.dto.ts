import { CompanySizeBucket } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUrl, Matches } from 'class-validator';

// GitHub issue #828 (Phase 57) — PATCH /companies/:id previously reused
// CreateCompanyDto, whose core fields (name/slug/sizeBucket) are
// required — a candidate fixing just `industry` had to resend all of
// them. Every field here is optional instead: Prisma's update() only
// ever writes the keys actually present on the DTO instance, so an
// omitted field here already left the existing column value untouched;
// the only thing blocking a true partial update was class-validator
// rejecting the request before it ever reached the service.
export class UpdateCompanyDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase, alphanumeric, hyphen-separated (e.g. "acme-corp")',
  })
  slug?: string;

  @IsOptional()
  @IsString()
  industry?: string;

  @IsOptional()
  @IsEnum(CompanySizeBucket)
  sizeBucket?: CompanySizeBucket;

  @IsOptional()
  @IsUrl()
  logoUrl?: string;
}
