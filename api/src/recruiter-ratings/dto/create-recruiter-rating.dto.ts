import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class CreateRecruiterRatingDto {
  @IsUUID()
  candidateId!: string;

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
