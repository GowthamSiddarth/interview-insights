import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

// candidateId is deliberately not a field here (GitHub issue #146) — it
// comes from the authenticated session (CurrentCandidateId), never from
// client input, so a candidate can't submit as another.
//
// Fields redesigned per GitHub issue #249 (docs/DECISIONS.md D48):
// reachability/responsiveness/guidelinesShared replace approachability/
// responseTime+timeliness/communicationQuality; rejectionMessageAuthenticity
// is genuinely new. Also used for updates (issue #150) — no separate
// UpdateRecruiterRatingDto exists.
export class CreateRecruiterRatingDto {
  @IsInt()
  @Min(1)
  @Max(5)
  reachability!: number;

  @IsInt()
  @Min(1)
  @Max(5)
  responsiveness!: number;

  @IsInt()
  @Min(1)
  @Max(5)
  guidelinesShared!: number;

  // Nullable by design — only meaningful for a touchpoint tied to the
  // process's rejection communication, self-reported by the candidate's own
  // judgment. Optional here, not required.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rejectionMessageAuthenticity?: number;

  @IsOptional()
  @IsString()
  freeText?: string;
}
