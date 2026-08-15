import { ModerationRejectionReason } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

// No auth/admin-user system yet (same gap as the rest of the API — see
// CLAUDE.md current status), so `reviewedBy` is just a free-text label for
// now rather than a resolved user id.
export class ModerationActionDto {
  @IsOptional()
  @IsString()
  reviewedBy?: string;

  // GitHub issue #688 (Phase 49, D104) — a moderator's own stated reason
  // for rejecting content, distinct from the system-set
  // ModerationFlagReason. Accepted on this shared DTO (reject() is the
  // only caller that gives it real meaning; ModerationService.review()
  // just persists whatever it's given) rather than a reject-only DTO
  // subclass, matching reviewedBy's own "one shared action DTO" shape.
  @IsOptional()
  @IsEnum(ModerationRejectionReason)
  rejectionReasonCategory?: ModerationRejectionReason;

  // Free-text elaboration, not gated to rejections — a moderator can add
  // context to an approval too.
  @IsOptional()
  @IsString()
  reviewNote?: string;
}
