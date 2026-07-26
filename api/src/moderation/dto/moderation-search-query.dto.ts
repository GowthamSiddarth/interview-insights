import { IsIn, IsOptional, IsString } from 'class-validator';
import { ModerationQueueCategory } from '../../search/moderation-queue-search.service';

const CATEGORIES: ModerationQueueCategory[] = ['interview-review', 'create-company'];

export class ModerationSearchQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsIn(CATEGORIES)
  category?: ModerationQueueCategory;
}
