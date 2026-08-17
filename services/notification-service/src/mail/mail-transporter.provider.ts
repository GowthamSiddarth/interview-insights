import { Provider } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

export const MAIL_TRANSPORTER = 'MAIL_TRANSPORTER';

// Duplicated from api/src/mail/mail-transporter.provider.ts on purpose —
// see docs/DECISIONS.md D73. Mailpit by default, same as api's; GitHub
// issue #655 (Phase 46) added the same optional-auth support here too,
// for the Hetzner pilot's real relay (Brevo) — see api's copy for the
// full `secure: false` reasoning (STARTTLS on 587 vs. Mailpit's no-TLS).
export const mailTransporterProvider: Provider = {
  provide: MAIL_TRANSPORTER,
  useFactory: () =>
    nodemailer.createTransport({
      host: process.env.MAIL_SMTP_HOST ?? 'localhost',
      port: Number(process.env.MAIL_SMTP_PORT ?? 1025),
      secure: false,
      auth: process.env.MAIL_SMTP_USER
        ? { user: process.env.MAIL_SMTP_USER, pass: process.env.MAIL_SMTP_PASSWORD }
        : undefined,
    }),
};
