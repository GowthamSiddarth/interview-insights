import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class CreateRoundRatingDto {
  @IsUUID()
  candidateId!: string;

  @IsInt()
  @Min(1)
  @Max(5)
  difficulty!: number;

  @IsInt()
  @Min(1)
  @Max(5)
  fairness!: number;

  @IsInt()
  @Min(1)
  @Max(5)
  communicationFluency!: number;

  @IsInt()
  @Min(1)
  @Max(5)
  attentiveness!: number;

  // Higher = less bias perceived — polarity per docs/DATA_MODEL.md.
  @IsInt()
  @Min(1)
  @Max(5)
  biasSignal!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  technicalDepth?: number;

  @IsOptional()
  @IsString()
  freeText?: string;
}
