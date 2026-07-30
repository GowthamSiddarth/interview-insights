import { Module } from '@nestjs/common';
import { ModerationModule } from '../moderation/moderation.module';
import { AiModerationModule } from './ai-moderation.module';
import { ReconciliationSweepService } from './reconciliation-sweep.service';

// GitHub issue #442 (Phase 39, D71) — a top-level module (imported directly
// into AppModule, like HealthModule/AnalyticsModule) rather than folded
// into AiModerationModule: this is app-wide scheduled infrastructure, not
// something a single write-path feature module pulls in for itself the
// way round-ratings/recruiter-ratings/overall-reviews pull in
// AiModerationModule.
@Module({
  imports: [AiModerationModule, ModerationModule],
  providers: [ReconciliationSweepService],
})
export class ReconciliationSweepModule {}
