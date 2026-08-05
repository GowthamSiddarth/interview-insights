import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { ModerationEntityType } from '@prisma/client';
import { ModerationQueueClaimState, ModerationQueueStatus } from '../moderation.service';

const ENTITY_TYPES: ModerationEntityType[] = ['round_rating', 'recruiter_rating', 'overall_review', 'company'];
const CLAIM_STATES: ModerationQueueClaimState[] = ['mine', 'unclaimed', 'all'];
const STATUSES: ModerationQueueStatus[] = ['pending', 'flagged'];

// GitHub issue #522 (Phase 41) — GET /moderation/queue's own filters,
// separate from ModerationSearchQueryDto's free-text q/category (a
// different route, GET /moderation/search, backed by OpenSearch rather
// than Postgres). claimState deliberately has no client-supplied
// moderator id — 'mine' is resolved by the controller from the
// authenticated caller, same pattern claim()/release() already use.
export class ModerationQueueQueryDto {
  @IsOptional()
  @IsIn(ENTITY_TYPES)
  entityType?: ModerationEntityType;

  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsOptional()
  @IsIn(CLAIM_STATES)
  claimState?: ModerationQueueClaimState;

  // A querystring can carry `status` once (a plain string) or repeated
  // (`?status=pending&status=flagged`, parsed as an array by Express'
  // querystring parser) — normalize to an array either way so `status`
  // is a consistent subset of STATUSES for the service layer.
  @IsOptional()
  @Transform(({ value }: { value: unknown }): unknown[] => (Array.isArray(value) ? (value as unknown[]) : [value]))
  @IsIn(STATUSES, { each: true })
  status?: ModerationQueueStatus[];
}
