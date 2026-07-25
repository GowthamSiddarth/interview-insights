import { IsArray, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateInterviewProcessDto } from '../../interview-processes/dto/create-interview-process.dto';
import { CreateOverallReviewDto } from '../../overall-reviews/dto/create-overall-review.dto';
import { CreateBulkRoundDto } from './create-bulk-round.dto';
import { CreateBulkRecruiterInteractionDto } from './create-bulk-recruiter-interaction.dto';

// GitHub issue #251 (Phase 25) — accepts an entire interview-process tree
// in one payload. candidateId is deliberately not a field anywhere in this
// tree (GitHub issue #146/D31) — it comes from the authenticated session,
// never from client input. Only the process itself is required; every
// nested piece is optional, since a candidate may not have reached every
// stage yet.
export class CreateBulkProcessDto extends CreateInterviewProcessDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateBulkRoundDto)
  rounds?: CreateBulkRoundDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateBulkRecruiterInteractionDto)
  recruiterInteractions?: CreateBulkRecruiterInteractionDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateOverallReviewDto)
  overallReview?: CreateOverallReviewDto;
}
