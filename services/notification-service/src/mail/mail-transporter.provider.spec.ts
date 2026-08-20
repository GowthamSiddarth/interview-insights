import * as nodemailer from 'nodemailer';
import { mailTransporterProvider } from './mail-transporter.provider';

// GitHub issue #831 (Phase 57) — nodemailer.createTransport() only builds
// a Transporter object; it doesn't open a socket until sendMail() is
// called, so spying on it here is safe (no real SMTP connection attempted).
describe('mailTransporterProvider', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  function useFactory(): unknown {
    const provider = mailTransporterProvider as { useFactory: () => unknown };
    return provider.useFactory();
  }

  it('defaults to Mailpit (localhost:1025, no auth) when no SMTP env vars are set', () => {
    delete process.env.MAIL_SMTP_HOST;
    delete process.env.MAIL_SMTP_PORT;
    delete process.env.MAIL_SMTP_USER;
    delete process.env.MAIL_SMTP_PASSWORD;
    const spy = jest.spyOn(nodemailer, 'createTransport');

    useFactory();

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'localhost', port: 1025, secure: false, auth: undefined }),
    );
  });

  it('reads host/port from env when set', () => {
    process.env.MAIL_SMTP_HOST = 'smtp-relay.brevo.com';
    process.env.MAIL_SMTP_PORT = '587';
    delete process.env.MAIL_SMTP_USER;
    const spy = jest.spyOn(nodemailer, 'createTransport');

    useFactory();

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp-relay.brevo.com', port: 587, secure: false }),
    );
  });

  it('includes auth only when MAIL_SMTP_USER is set (GitHub issue #655)', () => {
    process.env.MAIL_SMTP_USER = 'apikey';
    process.env.MAIL_SMTP_PASSWORD = 'secret';
    const spy = jest.spyOn(nodemailer, 'createTransport');

    useFactory();

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ auth: { user: 'apikey', pass: 'secret' } }),
    );
  });
});
