import { Module } from '@nestjs/common';
import { ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { SearchModule } from '../search/search.module';
import { EventsModule } from '../events/events.module';

// EventsModule import added by GitHub issue #332 — ModerationService now
// publishes domain events (created/status_changed), the first real
// consumer of DomainEventPublisher (GitHub issue #331). This is what
// finally connects the Redpanda producer at app boot across every
// environment, including CI's e2e run (see .github/workflows/ci.yml's
// `redpanda` service container).
@Module({
  imports: [SearchModule, AdminAuthModule, EventsModule],
  controllers: [ModerationController],
  providers: [ModerationService],
  exports: [ModerationService],
})
export class ModerationModule {}
