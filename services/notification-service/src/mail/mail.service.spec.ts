import { Test, TestingModule } from '@nestjs/testing';
import { MAIL_TRANSPORTER } from './mail-transporter.provider';
import { MailService } from './mail.service';

// GitHub issue #831 (Phase 57) — mirrors api/src/mail/mail.service.spec.ts
// exactly (this class is itself a deliberate duplicate — D73/D75).
describe('MailService', () => {
  let service: MailService;
  let transporter: { sendMail: jest.Mock };
  const originalFrom = process.env.MAIL_FROM_ADDRESS;

  beforeEach(async () => {
    transporter = { sendMail: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [MailService, { provide: MAIL_TRANSPORTER, useValue: transporter }],
    }).compile();

    service = module.get(MailService);
  });

  afterEach(() => {
    process.env.MAIL_FROM_ADDRESS = originalFrom;
  });

  it('sends via the injected transporter with the given recipient/subject/body', async () => {
    await service.send({ to: 'candidate@example.com', subject: 'Your submission was approved', text: 'details' });

    expect(transporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'candidate@example.com',
        subject: 'Your submission was approved',
        text: 'details',
      }),
    );
  });

  it('defaults the from address when MAIL_FROM_ADDRESS is unset', async () => {
    delete process.env.MAIL_FROM_ADDRESS;

    await service.send({ to: 'candidate@example.com', subject: 'x', text: 'y' });

    expect(transporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'noreply@interview-insights.local' }),
    );
  });

  it('uses MAIL_FROM_ADDRESS when set', async () => {
    process.env.MAIL_FROM_ADDRESS = 'notifications@interview-insights.example';

    await service.send({ to: 'candidate@example.com', subject: 'x', text: 'y' });

    expect(transporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'notifications@interview-insights.example' }),
    );
  });

  it('passes html through when provided', async () => {
    await service.send({ to: 'candidate@example.com', subject: 'x', text: 'y', html: '<p>y</p>' });

    expect(transporter.sendMail).toHaveBeenCalledWith(expect.objectContaining({ html: '<p>y</p>' }));
  });
});
