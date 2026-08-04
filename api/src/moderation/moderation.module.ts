import { Module } from '@nestjs/common';
import { ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';
import { SlaBreachDetectionService } from './sla-breach-detection.service';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { SearchModule } from '../search/search.module';
import { EventsModule } from '../events/events.module';

// EventsModule import added by GitHub issue #332 — ModerationService now
// publishes domain events (created/status_changed), the first real
// consumer of DomainEventPublisher (GitHub issue #331). This is what
// finally connects the Redpanda producer at app boot across every
// environment, including CI's e2e run (see .github/workflows/ci.yml's
// `redpanda` service container). SlaBreachDetectionService (GitHub issue
// #488) needs no further wiring beyond being a provider here — its
// @Cron decorator picks up ScheduleModule.forRoot()'s already-global
// registration in AppModule, same as every other @Cron/@Interval
// consumer in this codebase.
@Module({
  imports: [SearchModule, AdminAuthModule, EventsModule],
  controllers: [ModerationController],
  providers: [ModerationService, SlaBreachDetectionService],
  exports: [ModerationService],
})
export class ModerationModule {}
