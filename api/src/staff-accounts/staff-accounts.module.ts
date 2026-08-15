import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { EventsModule } from '../events/events.module';
import { StaffAccountsController } from './staff-accounts.controller';
import { StaffAccountsService } from './staff-accounts.service';

// GitHub issue #702 (Phase 51, D104) — EventsModule for DomainEventPublisher,
// same import every other write-path module already needs.
@Module({
  imports: [AdminAuthModule, EventsModule],
  controllers: [StaffAccountsController],
  providers: [StaffAccountsService],
})
export class StaffAccountsModule {}
