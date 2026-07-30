import { Module } from '@nestjs/common';
import { mailTransporterProvider } from './mail-transporter.provider';
import { MailService } from './mail.service';

// Duplicated from api/src/mail/mail.module.ts — see docs/DECISIONS.md D73.
@Module({
  providers: [mailTransporterProvider, MailService],
  exports: [MailService],
})
export class MailModule {}
