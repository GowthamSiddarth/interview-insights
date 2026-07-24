import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

// candidateId is deliberately not a field here (GitHub issue #146) — it
// comes from the authenticated session (CurrentCandidateId), never from
// client input, so a candidate can't submit as another.
export class CreateRecruiterRatingDto {
  @IsInt()
  @Min(1)
  @Max(5)
  approachability!: number;

  @IsInt()
  @Min(1)
  @Max(5)
  responseTime!: number;

  @IsInt()
  @Min(1)
  @Max(5)
  timeliness!: number;

  @IsInt()
  @Min(1)
  @Max(5)
  communicationQuality!: number;

  @IsOptional()
  @IsString()
  freeText?: string;
}
