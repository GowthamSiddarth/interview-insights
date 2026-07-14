import { RoundType } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateRoundDto {
  @IsInt()
  @Min(1)
  sequenceNumber!: number;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(RoundType)
  roundType!: RoundType;

  @IsOptional()
  @IsInt()
  @Min(1)
  scheduledDurationMinutes?: number;

  // Round-type-specific fields (docs/DATA_MODEL.md "type_metadata examples")
  // — not validated against a per-type shape here; that can follow once
  // round-type-specific forms exist.
  @IsOptional()
  @IsObject()
  typeMetadata?: Record<string, unknown>;
}
