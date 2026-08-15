import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { MailModule } from '../mail/mail.module';
import { NotificationConsumerService } from './notification-consumer.service';
import { ReconciliationSweepService } from './reconciliation-sweep.service';
import { StaffNotificationRecipientsService } from './staff-notification-recipients.service';

@Module({
  imports: [EventsModule, MailModule],
  providers: [NotificationConsumerService, ReconciliationSweepService, StaffNotificationRecipientsService],
})
export class NotificationsModule {}
