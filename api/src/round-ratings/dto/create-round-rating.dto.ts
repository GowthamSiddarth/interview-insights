import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

// candidateId is deliberately not a field here (GitHub issue #146) — it
// comes from the authenticated session (CurrentCandidateId), never from
// client input, so a candidate can't submit as another.
export class CreateRoundRatingDto {
  // Round/problem axis — not an interviewer trait (GitHub issue #247).
  @IsInt()
  @Min(1)
  @Max(5)
  difficulty!: number;

  // Interviewer traits, deliberately limited to three (GitHub issue #247,
  // docs/DECISIONS.md D45): fluency, clarity, focus.
  @IsInt()
  @Min(1)
  @Max(5)
  fluency!: number;

  @IsInt()
  @Min(1)
  @Max(5)
  clarity!: number;

  @IsInt()
  @Min(1)
  @Max(5)
  focus!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  technicalDepth?: number;

  @IsOptional()
  @IsString()
  freeText?: string;
}
