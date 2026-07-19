import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class CreateOverallReviewDto {
  @IsUUID()
  candidateId!: string;

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
