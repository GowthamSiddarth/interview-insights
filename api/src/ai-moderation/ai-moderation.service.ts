import { Inject, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { ModerationEntityType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ModerationService } from '../moderation/moderation.service';
import { ANTHROPIC_CLIENT } from './anthropic-client.provider';
import {
  getAnthropicModel,
  getAutoApprovalConfidenceThreshold,
  isAutoApprovalEnabled,
} from './ai-moderation.env';

// A create-company request has no round/recruiter/overall content to
// triage — same exclusion FraudChecksService's per-type checks already
// make.
export type TriageableEntityType = Exclude<ModerationEntityType, 'company'>;

// GitHub issue #440 (Phase 39, D71) — the fixed system-actor label
// ModerationActionDto.reviewedBy carries for every auto-approval, reusing
// that existing free-text field rather than inventing new plumbing (there's
// no real auth/admin-user system yet — same gap the DTO's own comment
// already documents).
export const AUTO_APPROVAL_SYSTEM_ACTOR = 'system:ai-auto-approval';

// requestVerdict()'s return shape — the parsed verdict plus everything
// GitHub issue #440's audit trail needs alongside it (the exact prompt/
// response pairing, confidence and model pulled out for easy reuse).
interface VerdictResult {
  verdict: Prisma.InputJsonObject;
  promptContent: string;
  responseText: string;
  confidence: number;
  model: string;
}

const SYSTEM_PROMPT = `You are a content-moderation triage assistant for an interview-experience review platform. Candidates submit ratings of individual interview rounds, recruiter interactions, and an overall process summary. You give a human moderator a second opinion on one submitted piece of content — you never approve or reject anything yourself, and your output is advisory only.

Look for: spam or nonsense text; a specific interviewer or recruiter named or otherwise identifiable by name (this platform never shows real names publicly, only generated labels like "Interviewer A" — flag any text that would defeat that); harassment or abusive language; and text that directly contradicts its own numeric scores (e.g. a 5-out-of-5 difficulty score paired with text calling the round "trivial").

Respond with a single JSON object and nothing else, matching exactly this shape:
{"concerning": boolean, "reasons": string[], "summary": string, "confidence": number}

"reasons" must be an empty array when "concerning" is false. "summary" is one sentence, written for a moderator who hasn't read the content yet. "confidence" is a 0-1 score for how confident you are in this verdict as a whole (1 = certain, 0 = a coin flip) — a low-confidence verdict should read as a weaker signal to the moderator regardless of which way "concerning" came out.`;

// GitHub issue #163 (Phase 19) — Claude API via @anthropic-ai/sdk,
// deliberately in-process/synchronous here (not an async event-driven
// worker): Phase 32 (D53) ports this same logic into a review-analyzer
// service once Phase 30's event bus exists, but that's a later
// extraction, not a scope change to what this does. Every write path for
// the three moderated entity types calls computeAndStoreVerdict() right
// after its own transaction commits, awaited before returning to the
// caller (unlike OpenSearch indexing's fire-and-forget-after-commit
// shape) — but fully best-effort: any failure here (disabled feature,
// network error, a refusal, an unparseable response) is caught and
// logged, never allowed to fail the write itself. This mirrors D16/D17's
// "never block the write" reasoning while still being a synchronous call
// in the request path, which is the explicit design this issue calls for.
@Injectable()
export class AiModerationService {
  private readonly logger = new Logger(AiModerationService.name);

  constructor(
    @Inject(ANTHROPIC_CLIENT) private readonly client: Anthropic | null,
    private readonly prisma: PrismaService,
    private readonly moderationService: ModerationService,
  ) {}

  async computeAndStoreVerdict(entityType: TriageableEntityType, entityId: string): Promise<void> {
    if (!this.client) return; // feature disabled — no ANTHROPIC_API_KEY configured

    try {
      const content = await this.buildContent(entityType, entityId);
      // The entity may already be gone (a fast create-then-delete
      // sequence) by the time this runs — nothing to triage, not an error.
      if (!content) return;

      const result = await this.requestVerdict(content);
      if (!result) return;

      await this.storeVerdict(entityType, entityId, result.verdict);

      // GitHub issue #440 (Phase 39, D71) — the only place a clean,
      // high-confidence verdict is actually acted on, not just recorded.
      // Still inside this method's own try/catch: a failure here (no
      // pending queue entry, a DB error) degrades to today's D66
      // advisory-only behavior — the entity simply stays `pending` for a
      // human moderator, the same fail-closed default an unset threshold
      // already produces.
      if (result.verdict.autoApprovalEligible === true) {
        await this.autoApprove(entityType, entityId, result);
      }
    } catch (err) {
      this.logger.error(
        `AI moderation triage failed for ${entityType} ${entityId} — leaving moderationVerdict unchanged`,
        err instanceof Error ? err.stack : err,
      );
    }
  }

  // Looks up the pending moderation_queue entry every write path already
  // created (enqueue()/reenqueue() always run before computeAndStoreVerdict()
  // is called — see round-ratings.service.ts etc.) and routes it through the
  // exact same ModerationService.approve() a human moderator's action already
  // calls, attributed to a fixed system actor — never a new, parallel path
  // that skips moderation_queue (D71). The audit row commits atomically with
  // that approval; see ModerationService.approveWithAudit().
  private async autoApprove(
    entityType: TriageableEntityType,
    entityId: string,
    result: VerdictResult,
  ): Promise<void> {
    const queueEntry = await this.prisma.moderationQueueEntry.findFirst({
      where: { entityType, entityId, reviewedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!queueEntry) {
      this.logger.warn(
        `Auto-approval eligible for ${entityType} ${entityId} but no pending moderation queue entry was found — leaving it advisory-only`,
      );
      return;
    }

    await this.moderationService.approveWithAudit(
      queueEntry.id,
      { reviewedBy: AUTO_APPROVAL_SYSTEM_ACTOR },
      {
        entityType,
        entityId,
        promptContent: result.promptContent,
        responseText: result.responseText,
        verdict: result.verdict,
        confidence: result.confidence,
        model: result.model,
      },
    );
  }

  private async buildContent(entityType: TriageableEntityType, entityId: string): Promise<string | null> {
    switch (entityType) {
      case 'round_rating': {
        const rating = await this.prisma.roundRating.findUnique({
          where: { id: entityId },
          include: { round: true },
        });
        if (!rating) return null;
        return [
          'Content type: interview round rating',
          `Round type: ${rating.round.roundType}`,
          // Registry-validated structured answers (GitHub issue #248) —
          // already human-readable strings, no lookup needed to render.
          `Round type-specific details: ${JSON.stringify(rating.round.typeMetadata)}`,
          `Scores (1-5): difficulty=${rating.difficulty}, fluency=${rating.fluency}, clarity=${rating.clarity}, focus=${rating.focus}, technicalDepth=${rating.technicalDepth ?? 'n/a'}`,
          `Free text: ${rating.freeText ?? '(none)'}`,
        ].join('\n');
      }
      case 'recruiter_rating': {
        const rating = await this.prisma.recruiterRating.findUnique({ where: { id: entityId } });
        if (!rating) return null;
        return [
          'Content type: recruiter interaction rating',
          `Scores (1-5): reachability=${rating.reachability}, responsiveness=${rating.responsiveness}, guidelinesShared=${rating.guidelinesShared}, rejectionMessageAuthenticity=${rating.rejectionMessageAuthenticity ?? 'n/a'}`,
          `Free text: ${rating.freeText ?? '(none)'}`,
        ].join('\n');
      }
      case 'overall_review': {
        const review = await this.prisma.overallReview.findUnique({ where: { id: entityId } });
        if (!review) return null;
        return [
          'Content type: overall interview process review',
          `Overall experience (1-5): ${review.overallExperience}`,
          `Would recommend: ${review.wouldRecommend}`,
          `Review text: ${review.reviewText ?? '(none)'}`,
        ].join('\n');
      }
    }
  }

  private async requestVerdict(userContent: string): Promise<VerdictResult | null> {
    const model = getAnthropicModel();
    const response = await this.client!.messages.create({
      model,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    });

    if (response.stop_reason === 'refusal') {
      this.logger.warn('AI moderation triage request was refused by the model');
      return null;
    }

    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === 'text',
    );
    if (!textBlock) return null;

    const parsed: unknown = JSON.parse(textBlock.text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;

    const record = parsed as Record<string, unknown>;
    const autoApprovalEligible = this.isEligibleForAutoApproval(record.concerning, record.confidence);
    const verdict: Prisma.InputJsonObject = {
      ...(parsed as Prisma.InputJsonObject),
      model,
      analyzedAt: new Date().toISOString(),
      // GitHub issue #439 (D71) — single hard confidence cutoff, computed
      // and persisted here so the actual system-attributed
      // ModerationService.approve() call (GitHub issue #440) can just read
      // this field rather than re-deriving it. Never true when the
      // threshold env var is unset — same "no numeric default" discipline
      // as ANTHROPIC_MODEL, but fails closed (not eligible) instead of
      // throwing, so an unconfigured threshold degrades to today's D66
      // advisory-only behavior rather than losing the verdict entirely.
      autoApprovalEligible,
    };

    return {
      verdict,
      promptContent: userContent,
      // Kept verbatim (not just the parsed object) for issue #440's audit
      // trail — the exact text the model returned, before any
      // reshaping/field-adding above.
      responseText: textBlock.text,
      // Safe only when autoApprovalEligible is true — isEligibleForAutoApproval()
      // already checked record.confidence is a finite number in that case.
      // Never read when it isn't (autoApprove() is only ever called when
      // autoApprovalEligible === true).
      confidence: record.confidence as number,
      model,
    };
  }

  private isEligibleForAutoApproval(concerning: unknown, confidence: unknown): boolean {
    // GitHub issue #441 (Phase 39, D71) — single global kill switch, checked
    // first and here alongside the confidence-threshold routing decision
    // (GitHub issue #439) rather than in a separate call site: one obvious
    // gate that forces every verdict back to D66's original advisory-only
    // behavior, no deploy needed to flip it.
    if (!isAutoApprovalEnabled()) return false;
    if (concerning !== false) return false;
    if (typeof confidence !== 'number' || Number.isNaN(confidence)) return false;

    const threshold = getAutoApprovalConfidenceThreshold();
    if (threshold === null) return false;

    return confidence >= threshold;
  }

  private async storeVerdict(
    entityType: TriageableEntityType,
    entityId: string,
    verdict: Prisma.InputJsonObject,
  ): Promise<void> {
    const data = { moderationVerdict: verdict };
    switch (entityType) {
      case 'round_rating':
        await this.prisma.roundRating.update({ where: { id: entityId }, data });
        break;
      case 'recruiter_rating':
        await this.prisma.recruiterRating.update({ where: { id: entityId }, data });
        break;
      case 'overall_review':
        await this.prisma.overallReview.update({ where: { id: entityId }, data });
        break;
    }
  }
}
