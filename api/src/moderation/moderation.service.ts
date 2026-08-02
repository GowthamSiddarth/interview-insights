import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ModerationEntityType, ModerationFlagReason, ModerationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewSearchService } from '../search/review-search.service';
import { CompanySearchService } from '../search/company-search.service';
import {
  ModerationQueueCategory,
  ModerationQueueSearchService,
} from '../search/moderation-queue-search.service';
import { DomainEventPublisher } from '../events/domain-event-publisher';
import {
  ROUND_RATING_CREATED_V1_TOPIC,
  RoundRatingCreatedEventV1,
} from '../events/schemas/round-rating-created.event';
import {
  ROUND_RATING_STATUS_CHANGED_V1_TOPIC,
  RoundRatingStatusChangedEventV1,
} from '../events/schemas/round-rating-status-changed.event';
import {
  RECRUITER_RATING_CREATED_V1_TOPIC,
  RecruiterRatingCreatedEventV1,
} from '../events/schemas/recruiter-rating-created.event';
import {
  RECRUITER_RATING_STATUS_CHANGED_V1_TOPIC,
  RecruiterRatingStatusChangedEventV1,
} from '../events/schemas/recruiter-rating-status-changed.event';
import {
  OVERALL_REVIEW_CREATED_V1_TOPIC,
  OverallReviewCreatedEventV1,
} from '../events/schemas/overall-review-created.event';
import {
  OVERALL_REVIEW_STATUS_CHANGED_V1_TOPIC,
  OverallReviewStatusChangedEventV1,
} from '../events/schemas/overall-review-status-changed.event';
import { ModerationActionDto } from './dto/moderation-action.dto';
import { ModerationFlagDto } from './dto/moderation-flag.dto';

type ModerationDecision = 'approved' | 'rejected' | 'flagged';
type PrismaTransaction = Prisma.TransactionClient;

// GitHub issue #440 (Phase 39, D71) — everything the verdict-consumer
// (GitHub issue #340, D81 — this project's first event consumer) needs to
// leave a durable trail of one auto-approval, written atomically with the
// approve() decision it documents (see approveWithAudit() below) so the two
// can never diverge (approved-without-audit, or audited-without-approve).
export interface AiAutoApprovalAuditInput {
  entityType: ModerationEntityType;
  entityId: string;
  promptContent: string;
  responseText: string;
  verdict: Prisma.InputJsonValue;
  confidence: number;
  model: string;
}

// The raw shape moderationQueueEntry.findMany() returns — the input
// enrichEntries() takes, shared by listPending() and search() alike.
interface RawQueueEntry {
  id: string;
  entityType: ModerationEntityType;
  entityId: string;
  flagReason: ModerationFlagReason | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

// GitHub issue #315 (Phase 29) — every field a candidate could have
// submitted for this entity, not just a "highlights" subset. `processId`
// exists purely so listPending() can group entries by submission; it's
// never rendered directly.
export interface ModerationQueueEntity {
  processId: string;
  companyName: string;
  roleTitle: string;
  freeText?: string | null;
  // round_rating
  roundTitle?: string | null;
  roundType?: string;
  roundDescription?: string | null;
  roundTypeMetadata?: Prisma.JsonValue | null;
  roundScheduledDurationMinutes?: number | null;
  difficulty?: number;
  fluency?: number;
  clarity?: number;
  focus?: number;
  technicalDepth?: number | null;
  // recruiter_rating — recruiterLabel is the generated label, never a
  // real name (CLAUDE.md hard constraint #1)
  recruiterLabel?: string;
  reachability?: number;
  responsiveness?: number;
  guidelinesShared?: number;
  rejectionMessageAuthenticity?: number | null;
  // overall_review
  overallExperience?: number;
  wouldRecommend?: boolean;
  reviewText?: string | null;
  // GitHub issue #163 (Phase 19) — advisory-only LLM triage output, one of
  // the three moderated content types only (never `company`). Null
  // whenever the feature is disabled or the LLM call hasn't landed yet —
  // absence is not itself a signal, just "no second opinion available."
  moderationVerdict?: Prisma.JsonValue | null;
  // company (GitHub issue #369, Phase 35) — a create-company request has
  // no InterviewProcess/roleTitle of its own; companyName holds the
  // *requested* name instead.
  requestedCompanySlug?: string;
  requestedCompanySizeBucket?: string;
  requestedCompanyIndustry?: string | null;
}

export interface ModerationQueueEntry {
  id: string;
  entityType: ModerationEntityType;
  entityId: string;
  flagReason: ModerationFlagReason | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  entity: ModerationQueueEntity | null;
}

// GitHub issue #315 (Phase 29) — one group per InterviewProcess, mirroring
// /me/submissions' own grouping (issue #149): a moderator thinks in terms
// of "this candidate's submission for Company X," not three disjoint
// entity-type lists. `processId` is null only for the rare degraded case
// where an entity's own enrichment transiently failed (D37) — grouped
// standalone rather than dropped.
export interface ModerationQueueGroup {
  processId: string | null;
  companyName: string;
  roleTitle: string;
  entries: ModerationQueueEntry[];
}

// Runs in-process within `api` for now — no Kafka consumer/`workers` process
// yet, since nothing else in the app produces to Redpanda either. Moving
// this onto a separate worker is deferred until there's actual async load to
// justify decoupling it (docs/DECISIONS.md D9), per docs/ROADMAP.md Phase 3.
@Injectable()
export class ModerationService {
  private readonly logger = new Logger(ModerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reviewSearchService: ReviewSearchService,
    private readonly companySearchService: CompanySearchService,
    private readonly moderationQueueSearchService: ModerationQueueSearchService,
    private readonly domainEventPublisher: DomainEventPublisher,
  ) {}

  // Called by the write path right after creating a rating/review — accepts
  // an optional transaction client so the moderation_queue row is created
  // atomically with the entity it references (docs/DATA_MODEL.md: this is a
  // polymorphic reference, intentionally not an FK, so nothing enforces that
  // pairing at the database level). `flagReason` is an optional pre-write
  // signal from FraudChecksService — the entity itself still starts
  // `pending` either way, see CLAUDE.md hard constraint #2.
  enqueue(
    entityType: ModerationEntityType,
    entityId: string,
    tx: PrismaTransaction = this.prisma,
    flagReason?: ModerationFlagReason,
  ) {
    return tx.moderationQueueEntry.create({ data: { entityType, entityId, flagReason } });
  }

  // Called by an entity's update() path (GitHub issue #150): an edit
  // resets the entity to `pending` and must get a fresh queue entry, but
  // if the previous submission is still unreviewed at edit time, leaving
  // that old entry alongside a new one would let a moderator review the
  // same entity twice — superseding (deleting) any still-unreviewed
  // entry first keeps exactly one live entry per entity.
  async reenqueue(entityType: ModerationEntityType, entityId: string, tx: PrismaTransaction = this.prisma) {
    await tx.moderationQueueEntry.deleteMany({ where: { entityType, entityId, reviewedAt: null } });
    return tx.moderationQueueEntry.create({ data: { entityType, entityId } });
  }

  // Called by an entity's delete path (GitHub issue #150): the entity
  // itself is gone, so every queue entry pointing at it — reviewed or
  // not — is removed too, since moderation_queue's reference is
  // polymorphic (not an FK) and nothing else would ever clean it up.
  removeQueueEntries(entityType: ModerationEntityType, entityId: string, tx: PrismaTransaction = this.prisma) {
    return tx.moderationQueueEntry.deleteMany({ where: { entityType, entityId } });
  }

  // Unreviewed queue entries, each enriched with its underlying entity's
  // own fields plus display context (company, role, generated labels) —
  // the moderation UI (Phase 14 issue #128) must be able to review an
  // entry without a second lookup, and pending entities are deliberately
  // unreadable through every public endpoint. Only generated labels ever
  // leave here (CLAUDE.md hard constraint #1) — never
  // internal_identifier_hash, and candidateId is omitted too since
  // moderating content doesn't require knowing who wrote it. Grouped by
  // InterviewProcess (GitHub issue #315, Phase 29) rather than returned
  // as a flat list — see ModerationQueueGroup's own comment.
  async listPending(): Promise<ModerationQueueGroup[]> {
    const entries = await this.prisma.moderationQueueEntry.findMany({
      where: { reviewedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    const enrichedEntries = await this.enrichEntries(entries);

    // GitHub issue #416 (D69) — self-heal any entry whose write-time
    // indexForSearch() call (D16/D17, best-effort) never landed — e.g.
    // OpenSearch was briefly unreachable right as a candidate submitted.
    // Without this, that one entry stays visible here (Postgres is the
    // source of truth for "pending") but permanently invisible to
    // /moderation/search, with nothing to ever retry it — the opposite
    // direction from D61's self-heal, which cleans up a stale doc for an
    // entity that's gone, not a live one missing its doc. Every queue
    // load already reads every pending entity fresh from Postgres, so
    // it's the natural place to catch this up; indexForSearch() swallows
    // its own errors and re-indexing an already-correct doc is a
    // harmless upsert, so this can't fail (or meaningfully slow down)
    // the read itself.
    await Promise.all(
      enrichedEntries
        .filter((entry) => entry.entity !== null)
        .map((entry) => this.indexForSearch(entry.entityType, entry.entityId)),
    );

    // Map preserves insertion order — groups naturally come out in the
    // same createdAt-ascending order entries already had, since each
    // group is created the moment its first (earliest) entry is seen.
    // An entry whose entity failed to enrich (no processId to group by)
    // gets its own standalone group keyed by the queue entry's own id,
    // rather than being silently dropped from the response.
    const groups = new Map<string, ModerationQueueGroup>();
    for (const entry of enrichedEntries) {
      const key = entry.entity?.processId ?? `unknown-${entry.id}`;
      let group = groups.get(key);
      if (!group) {
        group = {
          processId: entry.entity?.processId ?? null,
          companyName: entry.entity?.companyName ?? 'Unknown',
          roleTitle: entry.entity?.roleTitle ?? 'Unknown',
          entries: [],
        };
        groups.set(key, group);
      }
      group.entries.push(entry);
    }

    return Array.from(groups.values());
  }

  // GitHub issue #370 (Phase 35) — a fuzzy search/filter over the same
  // *pending* universe listPending() covers, backed by a dedicated
  // OpenSearch index rather than scanning Postgres. Returned as a flat
  // list (not grouped by submission, unlike listPending()) — a query can
  // legitimately match entries from many different, unrelated
  // submissions, so grouping would mostly just produce many one-entry
  // groups. Relevance order from OpenSearch is preserved; a hit whose
  // underlying moderation_queue row was resolved between the OpenSearch
  // query and this lookup (a genuine but rare race, same class as D37)
  // is simply absent from the final list rather than erroring.
  async search(
    q: string | undefined,
    category: ModerationQueueCategory | undefined,
  ): Promise<ModerationQueueEntry[]> {
    const hits = await this.moderationQueueSearchService.search(q, category);
    if (hits.length === 0) return [];

    const entries = await this.prisma.moderationQueueEntry.findMany({
      where: {
        reviewedAt: null,
        OR: hits.map((h) => ({ entityType: h.entityType, entityId: h.entityId })),
      },
    });
    const enrichedEntries = await this.enrichEntries(entries);

    const orderIndex = new Map(hits.map((h, i) => [`${h.entityType}:${h.entityId}`, i]));
    return [...enrichedEntries].sort(
      (a, b) =>
        (orderIndex.get(`${a.entityType}:${a.entityId}`) ?? 0) -
        (orderIndex.get(`${b.entityType}:${b.entityId}`) ?? 0),
    );
  }

  // Shared by listPending() and search() alike — every field a candidate
  // could have submitted for each entity type, plus display context
  // (company, role, generated labels). See listPending()'s own comment
  // for the D37 Promise.allSettled reasoning, which applies identically
  // here regardless of which caller asked for these particular entries.
  private async enrichEntries(entries: RawQueueEntry[]): Promise<ModerationQueueEntry[]> {
    const idsFor = (type: ModerationEntityType) =>
      entries.filter((e) => e.entityType === type).map((e) => e.entityId);

    const [roundRatingsResult, recruiterRatingsResult, overallReviewsResult, companiesResult] =
      await Promise.allSettled([
        this.prisma.roundRating.findMany({
          where: { id: { in: idsFor('round_rating') } },
          include: { round: { include: { process: { include: { company: true } } } } },
        }),
        this.prisma.recruiterRating.findMany({
          where: { id: { in: idsFor('recruiter_rating') } },
          include: {
            recruiterInteraction: {
              include: { recruiter: true, process: { include: { company: true } } },
            },
          },
        }),
        this.prisma.overallReview.findMany({
          where: { id: { in: idsFor('overall_review') } },
          include: { process: { include: { company: true } } },
        }),
        this.prisma.company.findMany({ where: { id: { in: idsFor('company') } } }),
      ]);

    const roundRatings = this.settledOrEmpty(roundRatingsResult, 'round_rating');
    const recruiterRatings = this.settledOrEmpty(recruiterRatingsResult, 'recruiter_rating');
    const overallReviews = this.settledOrEmpty(overallReviewsResult, 'overall_review');
    const companies = this.settledOrEmpty(companiesResult, 'company');

    // GitHub issue #383 (D61) — whether each type's own batch fetch
    // actually succeeded, independent of whether any particular id came
    // back. Distinguishes a *genuinely* missing entity (fetch succeeded,
    // this id just wasn't in the results — the only way that happens is a
    // raw-SQL deletion bypassing removeQueueEntries()) from D37's transient
    // per-batch failure (fetch itself rejected — kept as `entity: null`
    // below so a real, still-existing entity isn't dropped just because
    // this pass couldn't enrich it).
    const fetchSucceeded: Record<ModerationEntityType, boolean> = {
      round_rating: roundRatingsResult.status === 'fulfilled',
      recruiter_rating: recruiterRatingsResult.status === 'fulfilled',
      overall_review: overallReviewsResult.status === 'fulfilled',
      company: companiesResult.status === 'fulfilled',
    };

    const entityById = new Map<string, ModerationQueueEntity>();
    for (const r of roundRatings) {
      entityById.set(r.id, {
        processId: r.round.process.id,
        companyName: r.round.process.company.name,
        roleTitle: r.round.process.roleTitle,
        roundTitle: r.round.title,
        roundType: r.round.roundType,
        // Full round content (GitHub issue #315) — description,
        // typeMetadata (the round-type registry's structured answers,
        // already stored as human-readable strings — no registry lookup
        // needed to render them), and scheduled duration were fetched by
        // the include above all along but never surfaced before this.
        roundDescription: r.round.description,
        roundTypeMetadata: r.round.typeMetadata,
        roundScheduledDurationMinutes: r.round.scheduledDurationMinutes,
        difficulty: r.difficulty,
        fluency: r.fluency,
        clarity: r.clarity,
        focus: r.focus,
        technicalDepth: r.technicalDepth,
        freeText: r.freeText,
        moderationVerdict: r.moderationVerdict,
      });
    }
    for (const r of recruiterRatings) {
      entityById.set(r.id, {
        processId: r.recruiterInteraction.process.id,
        companyName: r.recruiterInteraction.process.company.name,
        roleTitle: r.recruiterInteraction.process.roleTitle,
        recruiterLabel: r.recruiterInteraction.recruiter.displayLabel,
        reachability: r.reachability,
        responsiveness: r.responsiveness,
        guidelinesShared: r.guidelinesShared,
        rejectionMessageAuthenticity: r.rejectionMessageAuthenticity,
        freeText: r.freeText,
        moderationVerdict: r.moderationVerdict,
      });
    }
    for (const r of overallReviews) {
      entityById.set(r.id, {
        processId: r.process.id,
        companyName: r.process.company.name,
        roleTitle: r.process.roleTitle,
        overallExperience: r.overallExperience,
        wouldRecommend: r.wouldRecommend,
        reviewText: r.reviewText,
        moderationVerdict: r.moderationVerdict,
      });
    }
    for (const c of companies) {
      // A create-company request has no InterviewProcess to group by —
      // a synthetic per-request key keeps each one in its own standalone
      // group, the same shape the enrichment-failure fallback already
      // uses, just keyed by this request's own id rather than a fallback.
      entityById.set(c.id, {
        processId: `company-request-${c.id}`,
        companyName: c.name,
        roleTitle: 'New company request',
        requestedCompanySlug: c.slug,
        requestedCompanySizeBucket: c.sizeBucket,
        requestedCompanyIndustry: c.industry,
      });
    }

    // GitHub issue #383 (D61) — self-heal genuine orphans found above
    // rather than surfacing them forever as "Unknown · Unknown" (and
    // leaving them one click away from review()'s own "Record not found."
    // crash): remove the stale queue entry and its search-index document,
    // and exclude it from the returned entries entirely.
    const enriched: ModerationQueueEntry[] = [];
    const orphaned: RawQueueEntry[] = [];
    for (const entry of entries) {
      const entity = entityById.get(entry.entityId) ?? null;
      if (entity === null && fetchSucceeded[entry.entityType]) {
        orphaned.push(entry);
        continue;
      }
      enriched.push({ ...entry, entity });
    }

    if (orphaned.length > 0) {
      this.logger.warn(
        `Removing ${orphaned.length} orphaned moderation queue ${orphaned.length === 1 ? 'entry' : 'entries'} whose underlying record no longer exists: ${orphaned.map((e) => `${e.entityType}:${e.entityId}`).join(', ')}`,
      );
      await this.prisma.moderationQueueEntry.deleteMany({ where: { id: { in: orphaned.map((e) => e.id) } } });
      await Promise.all(orphaned.map((e) => this.removeFromSearchIndex(e.entityType, e.entityId)));
    }

    return enriched;
  }

  approve(id: string, dto: ModerationActionDto) {
    return this.review(id, 'approved', dto);
  }

  reject(id: string, dto: ModerationActionDto) {
    return this.review(id, 'rejected', dto);
  }

  flag(id: string, dto: ModerationFlagDto) {
    return this.review(id, 'flagged', dto, dto.flagReason);
  }

  // GitHub issue #440 (Phase 39, D71) — the one entry point the
  // verdict-consumer (GitHub issue #340, D81) uses for a system-attributed
  // auto-approval. Deliberately still routes
  // through review() below — never a new, parallel path that skips
  // moderation_queue — with the one addition that the audit row is created
  // inside the *same* transaction as the queue-entry/entity-status update,
  // so the decision and its audit trail commit or fail together.
  approveWithAudit(id: string, dto: ModerationActionDto, audit: AiAutoApprovalAuditInput) {
    return this.review(id, 'approved', dto, undefined, audit);
  }

  private async review(
    id: string,
    decision: ModerationDecision,
    dto: ModerationActionDto,
    flagReason?: ModerationFlagReason,
    audit?: AiAutoApprovalAuditInput,
  ) {
    const entry = await this.prisma.moderationQueueEntry.findUniqueOrThrow({ where: { id } });

    if (entry.reviewedAt) {
      throw new ConflictException('This item has already been reviewed.');
    }

    // GitHub issue #383 (D61) — a raw-SQL deletion of an entity (bypassing
    // removeQueueEntries(), which every in-app delete path goes through)
    // can leave a stale queue entry with nothing left to review. Without
    // this check, the entity update below would throw Prisma's raw
    // "Record not found." — a confusing, unrecoverable dead end for the
    // moderator, since the entry can never be actioned again but also
    // never disappears on its own. enrichEntries() already self-heals
    // most of these on the next queue read (listPending()/search()), but
    // this closes the narrow race where a page is already open when its
    // entity gets deleted out from under it.
    if (!(await this.entityExists(entry.entityType, entry.entityId))) {
      await this.prisma.moderationQueueEntry.delete({ where: { id } });
      await this.removeFromSearchIndex(entry.entityType, entry.entityId);
      throw new NotFoundException(
        "This item's underlying record no longer exists. The stale queue entry has been removed.",
      );
    }

    // Every ModerationEntityType now has a write path (round_rating since
    // Phase 3, recruiter_rating/overall_review since Phase 14) — the
    // NotImplementedException guard that used to live here is gone because
    // there's nothing left to guard against; the switch is exhaustive over
    // the enum.
    const updatedEntry = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.moderationQueueEntry.update({
        where: { id },
        data: {
          reviewedAt: new Date(),
          reviewedBy: dto.reviewedBy,
          flagReason,
        },
      });
      const statusUpdate = { where: { id: entry.entityId }, data: { status: decision } };
      switch (entry.entityType) {
        case 'round_rating':
          await tx.roundRating.update(statusUpdate);
          break;
        case 'recruiter_rating':
          await tx.recruiterRating.update(statusUpdate);
          break;
        case 'overall_review':
          await tx.overallReview.update(statusUpdate);
          break;
        case 'company':
          await tx.company.update(statusUpdate);
          break;
      }
      // Same transaction as the queue-entry/entity-status update above —
      // see approveWithAudit()'s own comment for why this can't be a
      // separate, best-effort write.
      if (audit) {
        await tx.aiAutoApprovalAudit.create({
          data: {
            entityType: audit.entityType,
            entityId: audit.entityId,
            moderationQueueEntryId: id,
            promptContent: audit.promptContent,
            responseText: audit.responseText,
            verdict: audit.verdict,
            confidence: audit.confidence,
            model: audit.model,
          },
        });
      }
      return updated;
    });

    // Outside the transaction, best-effort — search indexing is derived
    // (docs/DECISIONS.md D16/D17), never allowed to fail the moderation
    // decision itself, which is already committed at this point.
    // recruiter_rating isn't indexed — review search stays round_rating-only
    // (docs/ROADMAP.md Phase 14, issue #125's explicit scope note).
    if (decision === 'approved' && entry.entityType === 'round_rating') {
      await this.indexApprovedReview(entry.entityId);
    }
    // GitHub issue #369 (Phase 35) — indexing a company moves from
    // creation time to approval time; rejecting never indexes anything,
    // and the row is kept (status: rejected) for an audit trail rather
    // than deleted.
    if (decision === 'approved' && entry.entityType === 'company') {
      await this.indexApprovedCompany(entry.entityId);
    }
    // GitHub issue #370 (Phase 35) — any resolution (approved, rejected,
    // or flagged) means this entry is no longer part of the *pending*
    // universe the moderator search box covers, regardless of which
    // public-facing index (if any) it also just got added to above.
    await this.removeFromSearchIndex(entry.entityType, entry.entityId);

    // GitHub issue #332 (Phase 30, D53) — best-effort domain event, same
    // after-commit shape as every other side-effect in this method. Only
    // the three rating/review entity types are in scope (see
    // publishStatusChangedEvent's own switch); 'company' is a no-op.
    await this.publishStatusChangedEvent(entry.entityType, entry.entityId, decision, dto.reviewedBy);

    return updatedEntry;
  }

  // Logs and degrades to an empty array rather than letting one entity
  // type's enrichment failure propagate — see the D37 comment on
  // listPending() for why this can transiently happen at all.
  private settledOrEmpty<T>(result: PromiseSettledResult<T[]>, entityType: ModerationEntityType): T[] {
    if (result.status === 'fulfilled') return result.value;
    this.logger.error(
      `Failed to enrich ${entityType} entries for the moderation queue — falling back to entity: null for this batch`,
      result.reason instanceof Error ? result.reason.stack : result.reason,
    );
    return [];
  }

  private async indexApprovedCompany(companyId: string) {
    try {
      const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
      await this.companySearchService.indexCompany(company);
    } catch (err) {
      this.logger.error(
        'Failed to index approved company in OpenSearch',
        err instanceof Error ? err.stack : err,
      );
    }
  }

  private async indexApprovedReview(roundRatingId: string) {
    try {
      const roundRating = await this.prisma.roundRating.findUniqueOrThrow({
        where: { id: roundRatingId },
        include: { round: { include: { process: true } } },
      });
      await this.reviewSearchService.indexReview({
        id: roundRating.id,
        companyId: roundRating.round.process.companyId,
        roleTitle: roundRating.round.process.roleTitle,
        roundType: roundRating.round.roundType,
        freeText: roundRating.freeText,
        createdAt: roundRating.createdAt,
        difficulty: roundRating.difficulty,
        fluency: roundRating.fluency,
        clarity: roundRating.clarity,
        focus: roundRating.focus,
      });
    } catch (err) {
      this.logger.error(
        'Failed to index approved review in OpenSearch',
        err instanceof Error ? err.stack : err,
      );
    }
  }

  // GitHub issue #332 (Phase 30, D53) — called by every write-path
  // service's create() right after its own transaction commits, same
  // best-effort/after-commit call shape as indexForSearch(). Only the
  // three rating/review entity types publish a domain event; 'company'
  // is out of scope for this issue (a create-company request isn't one
  // of the "moderated entity types" #331/#332 were scoped to) and is a
  // deliberate no-op, not an oversight. Fetches fresh from Postgres
  // rather than trusting caller context, same reasoning as
  // indexForSearch()'s own comment.
  async publishCreatedEvent(entityType: ModerationEntityType, entityId: string): Promise<void> {
    try {
      const occurredAt = new Date().toISOString();
      switch (entityType) {
        case 'round_rating': {
          const r = await this.prisma.roundRating.findUniqueOrThrow({
            where: { id: entityId },
            include: { round: { include: { process: true } } },
          });
          const event: RoundRatingCreatedEventV1 = {
            eventType: 'moderation.round_rating.created',
            eventVersion: 1,
            occurredAt,
            roundRatingId: r.id,
            roundId: r.roundId,
            candidateId: r.candidateId,
            companyId: r.round.process.companyId,
            status: 'pending',
          };
          await this.domainEventPublisher.publish(ROUND_RATING_CREATED_V1_TOPIC, event, r.id);
          return;
        }
        case 'recruiter_rating': {
          const r = await this.prisma.recruiterRating.findUniqueOrThrow({
            where: { id: entityId },
            include: { recruiterInteraction: { include: { process: true } } },
          });
          const event: RecruiterRatingCreatedEventV1 = {
            eventType: 'moderation.recruiter_rating.created',
            eventVersion: 1,
            occurredAt,
            recruiterRatingId: r.id,
            recruiterInteractionId: r.recruiterInteractionId,
            candidateId: r.candidateId,
            companyId: r.recruiterInteraction.process.companyId,
            status: 'pending',
          };
          await this.domainEventPublisher.publish(RECRUITER_RATING_CREATED_V1_TOPIC, event, r.id);
          return;
        }
        case 'overall_review': {
          const r = await this.prisma.overallReview.findUniqueOrThrow({
            where: { id: entityId },
            include: { process: true },
          });
          const event: OverallReviewCreatedEventV1 = {
            eventType: 'moderation.overall_review.created',
            eventVersion: 1,
            occurredAt,
            overallReviewId: r.id,
            processId: r.processId,
            candidateId: r.candidateId,
            companyId: r.process.companyId,
            status: 'pending',
          };
          await this.domainEventPublisher.publish(OVERALL_REVIEW_CREATED_V1_TOPIC, event, r.id);
          return;
        }
        case 'company':
          return;
      }
    } catch (err) {
      this.logger.error(
        `Failed to publish created event for ${entityType} ${entityId}`,
        err instanceof Error ? err.stack : err,
      );
    }
  }

  // Counterpart to publishCreatedEvent() above, called from review() once
  // a decision has committed. `newStatus` is already known from the
  // caller (the decision just made) — this only needs a fresh fetch for
  // the join context (candidateId/companyId etc.), same reasoning as
  // every other best-effort fetch in this class.
  private async publishStatusChangedEvent(
    entityType: ModerationEntityType,
    entityId: string,
    newStatus: ModerationStatus,
    reviewedBy: string | undefined,
  ): Promise<void> {
    try {
      const occurredAt = new Date().toISOString();
      switch (entityType) {
        case 'round_rating': {
          const r = await this.prisma.roundRating.findUniqueOrThrow({
            where: { id: entityId },
            include: { round: { include: { process: true } } },
          });
          const event: RoundRatingStatusChangedEventV1 = {
            eventType: 'moderation.round_rating.status_changed',
            eventVersion: 1,
            occurredAt,
            roundRatingId: r.id,
            roundId: r.roundId,
            candidateId: r.candidateId,
            companyId: r.round.process.companyId,
            previousStatus: 'pending',
            newStatus,
            reviewedBy,
          };
          await this.domainEventPublisher.publish(ROUND_RATING_STATUS_CHANGED_V1_TOPIC, event, r.id);
          return;
        }
        case 'recruiter_rating': {
          const r = await this.prisma.recruiterRating.findUniqueOrThrow({
            where: { id: entityId },
            include: { recruiterInteraction: { include: { process: true } } },
          });
          const event: RecruiterRatingStatusChangedEventV1 = {
            eventType: 'moderation.recruiter_rating.status_changed',
            eventVersion: 1,
            occurredAt,
            recruiterRatingId: r.id,
            recruiterInteractionId: r.recruiterInteractionId,
            candidateId: r.candidateId,
            companyId: r.recruiterInteraction.process.companyId,
            previousStatus: 'pending',
            newStatus,
            reviewedBy,
          };
          await this.domainEventPublisher.publish(RECRUITER_RATING_STATUS_CHANGED_V1_TOPIC, event, r.id);
          return;
        }
        case 'overall_review': {
          const r = await this.prisma.overallReview.findUniqueOrThrow({
            where: { id: entityId },
            include: { process: true },
          });
          const event: OverallReviewStatusChangedEventV1 = {
            eventType: 'moderation.overall_review.status_changed',
            eventVersion: 1,
            occurredAt,
            overallReviewId: r.id,
            processId: r.processId,
            candidateId: r.candidateId,
            companyId: r.process.companyId,
            previousStatus: 'pending',
            newStatus,
            reviewedBy,
          };
          await this.domainEventPublisher.publish(OVERALL_REVIEW_STATUS_CHANGED_V1_TOPIC, event, r.id);
          return;
        }
        case 'company':
          return;
      }
    } catch (err) {
      this.logger.error(
        `Failed to publish status_changed event for ${entityType} ${entityId}`,
        err instanceof Error ? err.stack : err,
      );
    }
  }

  // GitHub issue #370 (Phase 35) — called by every write-path service
  // right after its own transaction commits (enqueue()/reenqueue() run
  // *inside* that transaction, but OpenSearch indexing must never happen
  // before the row it describes is actually durable — same D16/D17
  // reasoning as indexApprovedReview/indexApprovedCompany above). Fully
  // best-effort: builds the document fresh from Postgres rather than
  // trusting whatever the caller already had in scope, so it stays
  // correct even if called from a context that doesn't have the joined
  // company/process fields handy.
  async indexForSearch(entityType: ModerationEntityType, entityId: string): Promise<void> {
    try {
      const doc = await this.buildIndexableEntry(entityType, entityId);
      // The entity may have already been deleted (or resolved) by the
      // time this runs, in a fast create-then-delete sequence — nothing
      // to index, not an error.
      if (!doc) return;
      await this.moderationQueueSearchService.indexEntry(doc);
    } catch (err) {
      this.logger.error(
        `Failed to index ${entityType} ${entityId} for moderator search`,
        err instanceof Error ? err.stack : err,
      );
    }
  }

  // Thin delegation — ModerationQueueSearchService.removeEntry() already
  // handles its own not-found/error cases internally (same shape as
  // ReviewSearchService.removeReview()), so callers throughout this
  // service and every write-path service only ever need to know about
  // ModerationService, never the search service directly.
  removeFromSearchIndex(entityType: ModerationEntityType, entityId: string): Promise<void> {
    return this.moderationQueueSearchService.removeEntry(entityType, entityId);
  }

  // GitHub issue #383 (D61) — a cheap existence check, used by review()'s
  // orphan guard above. Deliberately a single `findUnique`/`select: { id }`
  // per type rather than reusing buildIndexableEntry() (which does a much
  // heavier join this check has no use for).
  private async entityExists(entityType: ModerationEntityType, entityId: string): Promise<boolean> {
    switch (entityType) {
      case 'round_rating':
        return (await this.prisma.roundRating.findUnique({ where: { id: entityId }, select: { id: true } })) !== null;
      case 'recruiter_rating':
        return (
          (await this.prisma.recruiterRating.findUnique({ where: { id: entityId }, select: { id: true } })) !== null
        );
      case 'overall_review':
        return (
          (await this.prisma.overallReview.findUnique({ where: { id: entityId }, select: { id: true } })) !== null
        );
      case 'company':
        return (await this.prisma.company.findUnique({ where: { id: entityId }, select: { id: true } })) !== null;
    }
  }

  private async buildIndexableEntry(
    entityType: ModerationEntityType,
    entityId: string,
  ): Promise<{
    entityType: ModerationEntityType;
    entityId: string;
    category: ModerationQueueCategory;
    companyName: string;
    roleTitle: string | null;
    freeTextPreview: string | null;
    createdAt: Date;
  } | null> {
    switch (entityType) {
      case 'round_rating': {
        const r = await this.prisma.roundRating.findUnique({
          where: { id: entityId },
          include: { round: { include: { process: { include: { company: true } } } } },
        });
        if (!r) return null;
        return {
          entityType,
          entityId,
          category: 'interview-review',
          companyName: r.round.process.company.name,
          roleTitle: r.round.process.roleTitle,
          freeTextPreview: r.freeText,
          createdAt: r.createdAt,
        };
      }
      case 'recruiter_rating': {
        const r = await this.prisma.recruiterRating.findUnique({
          where: { id: entityId },
          include: { recruiterInteraction: { include: { process: { include: { company: true } } } } },
        });
        if (!r) return null;
        return {
          entityType,
          entityId,
          category: 'interview-review',
          companyName: r.recruiterInteraction.process.company.name,
          roleTitle: r.recruiterInteraction.process.roleTitle,
          freeTextPreview: r.freeText,
          createdAt: r.createdAt,
        };
      }
      case 'overall_review': {
        const r = await this.prisma.overallReview.findUnique({
          where: { id: entityId },
          include: { process: { include: { company: true } } },
        });
        if (!r) return null;
        return {
          entityType,
          entityId,
          category: 'interview-review',
          companyName: r.process.company.name,
          roleTitle: r.process.roleTitle,
          freeTextPreview: r.reviewText,
          createdAt: r.createdAt,
        };
      }
      case 'company': {
        const c = await this.prisma.company.findUnique({ where: { id: entityId } });
        if (!c) return null;
        return {
          entityType,
          entityId,
          category: 'create-company',
          companyName: c.name,
          roleTitle: null,
          freeTextPreview: null,
          createdAt: c.createdAt,
        };
      }
    }
  }
}
