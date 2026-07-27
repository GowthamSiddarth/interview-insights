import { Module } from '@nestjs/common';
import { anthropicClientProvider } from './anthropic-client.provider';
import { AiModerationService } from './ai-moderation.service';

@Module({
  providers: [anthropicClientProvider, AiModerationService],
  exports: [AiModerationService],
})
export class AiModerationModule {}
