import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

// candidateId is deliberately not a field here (GitHub issue #146) — it
// comes from the authenticated session (CurrentCandidateId), never from
// client input, so a candidate can't submit as another.
export class CreateOverallReviewDto {
  @IsInt()
  @Min(1)
  @Max(5)
  overallExperience!: number;

  @IsBoolean()
  wouldRecommend!: boolean;

  @IsOptional()
  @IsString()
  reviewText?: string;
}
