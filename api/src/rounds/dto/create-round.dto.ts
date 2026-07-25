import { RoundType } from '@prisma/client';
import { IsEnum, IsInt, IsObject, IsOptional, IsString, Min } from 'class-validator';

export class CreateRoundDto {
  @IsInt()
  @Min(1)
  sequenceNumber!: number;

  // Optional (GitHub issue #287, Phase 28) — a round doesn't need a title
  // for a candidate to submit it; display sites fall back to just the
  // round type when it's absent.
  @IsOptional()
  @IsString()
  title?: string;

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
