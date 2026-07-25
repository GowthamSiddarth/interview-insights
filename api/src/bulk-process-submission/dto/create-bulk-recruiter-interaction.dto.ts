import { IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateRecruiterRatingDto } from '../../recruiter-ratings/dto/create-recruiter-rating.dto';

// A recruiter interaction nested inside a bulk process submission. `rating`
// is optional — a candidate may log a touchpoint without rating it yet.
export class CreateBulkRecruiterInteractionDto {
  @IsString()
  @IsNotEmpty()
  recruiterIdentifier!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateRecruiterRatingDto)
  rating?: CreateRecruiterRatingDto;
}
