import { Provider } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

export const MAIL_TRANSPORTER = 'MAIL_TRANSPORTER';

// Duplicated from api/src/mail/mail-transporter.provider.ts on purpose —
// see docs/DECISIONS.md D73. Mailpit only, same as api's.
export const mailTransporterProvider: Provider = {
  provide: MAIL_TRANSPORTER,
  useFactory: () =>
    nodemailer.createTransport({
      host: process.env.MAIL_SMTP_HOST ?? 'localhost',
      port: Number(process.env.MAIL_SMTP_PORT ?? 1025),
      secure: false, // Mailpit doesn't speak TLS
    }),
};
