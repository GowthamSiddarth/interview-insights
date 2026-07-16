import { ModerationFlagReason } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { ModerationActionDto } from './moderation-action.dto';

export class ModerationFlagDto extends ModerationActionDto {
  @IsOptional()
  @IsEnum(ModerationFlagReason)
  flagReason?: ModerationFlagReason;
}
