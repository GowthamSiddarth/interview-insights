import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { ModerationModule } from '../moderation/moderation.module';
import { VerdictConsumerService } from './verdict-consumer.service';

// GitHub issue #340 (Phase 32, D81) — api's first-ever event consumer.
// Needs ModerationModule for ModerationService.approveWithAudit()/flag(),
// same as the deleted AiModerationModule/ReconciliationSweepModule did.
@Module({
  imports: [EventsModule, ModerationModule],
  providers: [VerdictConsumerService],
})
export class VerdictConsumerModule {}
