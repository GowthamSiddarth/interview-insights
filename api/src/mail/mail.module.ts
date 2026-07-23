import { Module } from '@nestjs/common';
import { mailTransporterProvider } from './mail-transporter.provider';
import { MailService } from './mail.service';

@Module({
  providers: [mailTransporterProvider, MailService],
  exports: [MailService],
})
export class MailModule {}
