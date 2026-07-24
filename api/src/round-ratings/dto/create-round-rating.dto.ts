import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

// candidateId is deliberately not a field here (GitHub issue #146) — it
// comes from the authenticated session (CurrentCandidateId), never from
// client input, so a candidate can't submit as another.
export class CreateRoundRatingDto {
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
