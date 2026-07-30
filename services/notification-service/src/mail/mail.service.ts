import { Inject, Injectable } from '@nestjs/common';
import { Transporter } from 'nodemailer';
import { MAIL_TRANSPORTER } from './mail-transporter.provider';

export interface SendMailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

// Duplicated from api/src/mail/mail.service.ts on purpose — see
// docs/DECISIONS.md D73/D75. This service never needs the generic
// `{to, subject, text, html?}` shape for anything beyond the two fixed
// templates it sends (pending-review here, approved/rejected in #336).
@Injectable()
export class MailService {
  constructor(@Inject(MAIL_TRANSPORTER) private readonly transporter: Transporter) {}

  async send(input: SendMailInput): Promise<void> {
    await this.transporter.sendMail({
      from: process.env.MAIL_FROM_ADDRESS ?? 'noreply@interview-insights.local',
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
  }
}
