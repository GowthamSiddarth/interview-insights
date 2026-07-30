import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { MailModule } from '../mail/mail.module';
import { NotificationConsumerService } from './notification-consumer.service';

@Module({
  imports: [EventsModule, MailModule],
  providers: [NotificationConsumerService],
})
export class NotificationsModule {}
