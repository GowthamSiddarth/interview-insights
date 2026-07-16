import { IsOptional, IsString } from 'class-validator';

// No auth/admin-user system yet (same gap as the rest of the API — see
// CLAUDE.md current status), so `reviewedBy` is just a free-text label for
// now rather than a resolved user id.
export class ModerationActionDto {
  @IsOptional()
  @IsString()
  reviewedBy?: string;
}
