import { Inject, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { ModerationEntityType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ANTHROPIC_CLIENT } from './anthropic-client.provider';
import { getAnthropicModel } from './ai-moderation.env';

// A create-company request has no round/recruiter/overall content to
// triage — same exclusion FraudChecksService's per-type checks already
// make.
export type TriageableEntityType = Exclude<ModerationEntityType, 'company'>;

const SYSTEM_PROMPT = `You are a content-moderation triage assistant for an interview-experience review platform. Candidates submit ratings of individual interview rounds, recruiter interactions, and an overall process summary. You give a human moderator a second opinion on one submitted piece of content — you never approve or reject anything yourself, and your output is advisory only.

Look for: spam or nonsense text; a specific interviewer or recruiter named or otherwise identifiable by name (this platform never shows real names publicly, only generated labels like "Interviewer A" — flag any text that would defeat that); harassment or abusive language; and text that directly contradicts its own numeric scores (e.g. a 5-out-of-5 difficulty score paired with text calling the round "trivial").

Respond with a single JSON object and nothing else, matching exactly this shape:
{"concerning": boolean, "reasons": string[], "summary": string}

"reasons" must be an empty array when "concerning" is false. "summary" is one sentence, written for a moderator who hasn't read the content yet.`;

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
  ) {}

  async computeAndStoreVerdict(entityType: TriageableEntityType, entityId: string): Promise<void> {
    if (!this.client) return; // feature disabled — no ANTHROPIC_API_KEY configured

    try {
      const content = await this.buildContent(entityType, entityId);
      // The entity may already be gone (a fast create-then-delete
      // sequence) by the time this runs — nothing to triage, not an error.
      if (!content) return;

      const verdict = await this.requestVerdict(content);
      if (!verdict) return;

      await this.storeVerdict(entityType, entityId, verdict);
    } catch (err) {
      this.logger.error(
        `AI moderation triage failed for ${entityType} ${entityId} — leaving moderationVerdict unchanged`,
        err instanceof Error ? err.stack : err,
      );
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

  private async requestVerdict(userContent: string): Promise<Prisma.InputJsonObject | null> {
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

    return {
      ...(parsed as Prisma.InputJsonObject),
      model,
      analyzedAt: new Date().toISOString(),
    };
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
