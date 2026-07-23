import { Provider } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

export const MAIL_TRANSPORTER = 'MAIL_TRANSPORTER';

// Mailpit only (GitHub issue #144, Phase 16) — a local SMTP catcher, not
// a real provider integration; see docs/DECISIONS.md for the
// Mailpit-over-LocalStack-SES rationale.
export const mailTransporterProvider: Provider = {
  provide: MAIL_TRANSPORTER,
  useFactory: () =>
    nodemailer.createTransport({
      host: process.env.MAIL_SMTP_HOST ?? 'localhost',
      port: Number(process.env.MAIL_SMTP_PORT ?? 1025),
      secure: false, // Mailpit doesn't speak TLS
    }),
};
