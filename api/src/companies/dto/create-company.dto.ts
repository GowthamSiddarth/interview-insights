import { CompanySizeBucket } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUrl, Matches } from 'class-validator';

export class CreateCompanyDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase, alphanumeric, hyphen-separated (e.g. "acme-corp")',
  })
  slug!: string;

  @IsOptional()
  @IsString()
  industry?: string;

  @IsEnum(CompanySizeBucket)
  sizeBucket!: CompanySizeBucket;

  @IsOptional()
  @IsUrl()
  logoUrl?: string;
}
