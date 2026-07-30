import { Module } from '@nestjs/common';
import { ModerationModule } from '../moderation/moderation.module';
import { anthropicClientProvider } from './anthropic-client.provider';
import { AiModerationService } from './ai-moderation.service';

@Module({
  // GitHub issue #440 (Phase 39, D71) — AiModerationService now calls
  // ModerationService.approveWithAudit() for auto-approval-eligible
  // verdicts, so it needs ModerationService itself.
  imports: [ModerationModule],
  providers: [anthropicClientProvider, AiModerationService],
  exports: [AiModerationService],
})
export class AiModerationModule {}
