import { Equals, IsBoolean, IsISO8601, IsNumber, IsObject, IsOptional, IsString, IsUUID, ValidateIf } from 'class-validator';

// GitHub issue #782 (Phase 52) — schema validation for verdict_computed
// events at the consumer boundary, matching the shape review-analyzer's
// own copy of these interfaces produces (api/src/events/schemas/*-verdict-
// computed.event.ts). Currently mitigated by Redpanda being internal-only
// (only review-analyzer publishes to these topics), but nothing at this
// consumer itself previously checked a malformed/malicious payload before
// it reached a Prisma update and got written into moderationVerdict as raw
// JSON — this is that defense-in-depth layer.
//
// `verdict`/`confidence`/`model`/`promptContent`/`responseText` are all
// `T | null` (never optional) on the wire — ValidateIf lets null through
// unvalidated while still requiring the field be present at all (a
// genuinely missing field fails, same as a wrong-typed one).
export abstract class BaseVerdictComputedEventDto {
  @Equals(1)
  eventVersion!: 1;

  @IsISO8601()
  occurredAt!: string;

  @ValidateIf((_o: unknown, value: unknown) => value !== null)
  @IsObject()
  verdict!: Record<string, unknown> | null;

  @IsBoolean()
  autoApprovalEligible!: boolean;

  @ValidateIf((_o: unknown, value: unknown) => value !== null)
  @IsNumber()
  confidence!: number | null;

  @ValidateIf((_o: unknown, value: unknown) => value !== null)
  @IsString()
  model!: string | null;

  @ValidateIf((_o: unknown, value: unknown) => value !== null)
  @IsString()
  promptContent!: string | null;

  @ValidateIf((_o: unknown, value: unknown) => value !== null)
  @IsString()
  responseText!: string | null;

  @IsOptional()
  @Equals(true)
  stalled?: true;
}

export class RoundRatingVerdictComputedEventDto extends BaseVerdictComputedEventDto {
  @Equals('moderation.round_rating.verdict_computed')
  eventType!: 'moderation.round_rating.verdict_computed';

  @IsUUID()
  roundRatingId!: string;
}

export class RecruiterRatingVerdictComputedEventDto extends BaseVerdictComputedEventDto {
  @Equals('moderation.recruiter_rating.verdict_computed')
  eventType!: 'moderation.recruiter_rating.verdict_computed';

  @IsUUID()
  recruiterRatingId!: string;
}

export class OverallReviewVerdictComputedEventDto extends BaseVerdictComputedEventDto {
  @Equals('moderation.overall_review.verdict_computed')
  eventType!: 'moderation.overall_review.verdict_computed';

  @IsUUID()
  overallReviewId!: string;
}
