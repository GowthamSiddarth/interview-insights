import { Inject, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service';
import { ANTHROPIC_CLIENT } from './anthropic-client.provider';
import { getAnthropicModel, getAutoApprovalConfidenceThreshold, isAutoApprovalEnabled } from './ai-moderation.env';

// The three entity types this service ever triages — mirrors api's own
// TriageableEntityType (a create-company request has no round/recruiter/
// overall content to triage, and review-analyzer never subscribes to
// moderation.company.created.v1 in the first place).
export type TriageableEntityType = 'round_rating' | 'recruiter_rating' | 'overall_review';

// computeVerdict()'s return shape — the parsed verdict plus everything the
// verdict_computed event needs alongside it (the exact prompt/response
// pairing, confidence and model pulled out for easy reuse by api's own
// audit trail, GitHub issue #440).
export interface VerdictResult {
  verdict: Record<string, unknown>;
  promptContent: string;
  responseText: string;
  confidence: number;
  model: string;
}

// GitHub issue #827 (Phase 57) — 5xx, 429, and connection/timeout errors are
// the same class the Anthropic SDK itself already retries before giving up
// (`APIConnectionError` covers both plain connection failures and
// `APIConnectionTimeoutError`; `status` is undefined for those and set for
// every `APIError` subclass, including `RateLimitError` (429) and
// `InternalServerError` (5xx)) — everything else (auth, bad request, parse
// failure, missing entity) is terminal and won't resolve on its own.
function isRetryableApiError(err: unknown): boolean {
  if (err instanceof Anthropic.APIConnectionError) return true;
  if (err instanceof Anthropic.APIError) {
    return err.status === 429 || (typeof err.status === 'number' && err.status >= 500);
  }
  return false;
}

const SYSTEM_PROMPT = `You are a content-moderation triage assistant for an interview-experience review platform. Candidates submit ratings of individual interview rounds, recruiter interactions, and an overall process summary. You give a human moderator a second opinion on one submitted piece of content — you never approve or reject anything yourself, and your output is advisory only.

Look for: spam or nonsense text; a specific interviewer or recruiter named or otherwise identifiable by name (this platform never shows real names publicly, only generated labels like "Interviewer A" — flag any text that would defeat that); harassment or abusive language; and text that directly contradicts its own numeric scores (e.g. a 5-out-of-5 difficulty score paired with text calling the round "trivial").

Respond with a single JSON object and nothing else, matching exactly this shape:
{"concerning": boolean, "reasons": string[], "summary": string, "confidence": number}

"reasons" must be an empty array when "concerning" is false. "summary" is one sentence, written for a moderator who hasn't read the content yet. "confidence" is a 0-1 score for how confident you are in this verdict as a whole (1 = certain, 0 = a coin flip) — a low-confidence verdict should read as a weaker signal to the moderator regardless of which way "concerning" came out.`;

// GitHub issue #340 (Phase 32, D81) — this is api's old AiModerationService.
// requestVerdict()/buildContent(), ported verbatim except for two things:
// content is read from this service's own read-only Prisma tables (D75)
// instead of api's, and the result is never written to a DB or acted on
// here — AnalysisConsumerService publishes it as a verdict_computed event
// instead, and api's own consumer applies it (storing moderationVerdict,
// running auto-approval) — this service never touches moderation_queue.
@Injectable()
export class AnalysisService {
  private readonly logger = new Logger(AnalysisService.name);

  constructor(
    @Inject(ANTHROPIC_CLIENT) private readonly client: Anthropic | null,
    private readonly prisma: PrismaService,
  ) {}

  // Returns null when the feature is disabled, the entity is already gone
  // (a fast create-then-delete race), or the LLM call/parse failed — every
  // failure is caught and logged, never thrown, same best-effort shape
  // AiModerationService's computeAndStoreVerdict() had.
  //
  // GitHub issue #827 (Phase 57) — this catch used to log every failure
  // mode identically. The Anthropic SDK's own client already retries
  // retryable errors (429/5xx/timeouts/connection resets — see its
  // `maxRetries` default) internally before ever throwing here, so by the
  // time an error reaches this catch, a transient blip has already had a
  // shot at self-healing. What's still missing is *distinguishability* in
  // the log: isRetryableApiError() below separates "the retries were
  // exhausted, this may well recover on the next submission" from every
  // other failure (parse error, missing entity, malformed response) so an
  // operator can tell a traffic-spike-driven burst of retryable errors
  // apart from "the feature silently switched off" without waiting for
  // ReconciliationSweepService's 24h sweep to say more.
  async computeVerdict(entityType: TriageableEntityType, entityId: string): Promise<VerdictResult | null> {
    if (!this.client) return null; // feature disabled — no ANTHROPIC_API_KEY configured

    try {
      const content = await this.buildContent(entityType, entityId);
      if (!content) return null;

      return await this.requestVerdict(content);
    } catch (err: unknown) {
      const stack = err instanceof Error ? err.stack : err;
      if (isRetryableApiError(err)) {
        this.logger.warn(
          `AI moderation triage hit a retryable API error for ${entityType} ${entityId} (already retried internally by the SDK) — likely transient; ReconciliationSweepService's 24h sweep will re-triage if it doesn't recover on its own`,
          stack,
        );
      } else {
        this.logger.error(`AI moderation triage failed for ${entityType} ${entityId}`, stack);
      }
      return null;
    }
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

    const textBlock = response.content.find((block): block is Anthropic.TextBlock => block.type === 'text');
    if (!textBlock) return null;

    // GitHub issue #453 — despite SYSTEM_PROMPT's explicit "a single JSON
    // object and nothing else," real responses sometimes wrap the object in
    // a markdown code fence. Stripped defensively rather than tightened via
    // a stricter prompt.
    const jsonText = textBlock.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

    const parsed: unknown = JSON.parse(jsonText);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;

    const record = parsed as Record<string, unknown>;
    const autoApprovalEligible = this.isEligibleForAutoApproval(record.concerning, record.confidence);
    const verdict: Record<string, unknown> = {
      ...record,
      model,
      analyzedAt: new Date().toISOString(),
      // GitHub issue #439 (D71) — computed here, not by api's consumer, now
      // that this service is the one with confidence/threshold in hand.
      autoApprovalEligible,
    };

    return {
      verdict,
      promptContent: userContent,
      responseText: textBlock.text,
      // Safe only when autoApprovalEligible is true — isEligibleForAutoApproval()
      // already checked record.confidence is a finite number in that case.
      confidence: record.confidence as number,
      model,
    };
  }

  private isEligibleForAutoApproval(concerning: unknown, confidence: unknown): boolean {
    if (!isAutoApprovalEnabled()) return false;
    if (concerning !== false) return false;
    if (typeof confidence !== 'number' || Number.isNaN(confidence)) return false;

    const threshold = getAutoApprovalConfidenceThreshold();
    if (threshold === null) return false;

    return confidence >= threshold;
  }
}
