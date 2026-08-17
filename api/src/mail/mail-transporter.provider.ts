import { Provider } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

export const MAIL_TRANSPORTER = 'MAIL_TRANSPORTER';

// Mailpit by default (GitHub issue #144, Phase 16) — a local SMTP
// catcher, not a real provider integration; see docs/DECISIONS.md for
// the Mailpit-over-LocalStack-SES rationale. GitHub issue #655 (Phase
// 46) added optional auth for the Hetzner pilot's real relay (Brevo) —
// `secure: false` stays correct for both: Mailpit has no TLS at all,
// and Brevo's port 587 negotiates STARTTLS opportunistically under
// `secure: false` (nodemailer only forces implicit TLS when `secure` is
// true, which is port 465's job, not 587's). MAIL_SMTP_USER unset (the
// case for every environment but the pilot) means no `auth` block at
// all, unchanged behavior from before this issue.
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
