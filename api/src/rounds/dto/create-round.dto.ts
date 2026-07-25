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

  // Round-type-specific fields — shape-only here (some object); the
  // per-round-type semantic validation (right keys, controlled-vocabulary
  // values active in round_type_field_options) lives in
  // RoundsService.create(), see api/src/round-type-registry.
  @IsOptional()
  @IsObject()
  typeMetadata?: Record<string, unknown>;
}
