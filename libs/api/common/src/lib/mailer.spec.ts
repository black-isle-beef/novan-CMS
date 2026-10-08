import { createMailer, type MailerConfig, mailerConfigFromEnv } from './mailer';

const config = (provider: MailerConfig['provider']): MailerConfig => ({
  provider,
  from: 'Novan CMS <no-reply@novan.test>',
  mailpitUrl: 'http://mailpit.test',
  resendApiKey: 're_key',
  postmarkToken: 'pm_token',
});
const mail = { to: ['ada@example.com'], subject: 'Review requested: Home', text: 'Please look.' };

describe('mailer', () => {
  it('picks Mailpit locally, nothing in production until a provider is set', () => {
    expect(mailerConfigFromEnv({}).provider).toBe('mailpit');
    expect(mailerConfigFromEnv({ NODE_ENV: 'production' }).provider).toBe('log');
    expect(mailerConfigFromEnv({ NODE_ENV: 'production', MAIL_PROVIDER: 'resend' }).provider).toBe('resend');
    expect(mailerConfigFromEnv({ MAIL_PROVIDER: 'carrier-pigeon' }).provider).toBe('mailpit');
  });

  it.each([
    ['mailpit', 'http://mailpit.test/api/v1/send', { From: { Email: 'no-reply@novan.test', Name: 'Novan CMS' }, To: [{ Email: 'ada@example.com' }], Subject: mail.subject, Text: mail.text }, {}],
    ['resend', 'https://api.resend.com/emails', { from: 'Novan CMS <no-reply@novan.test>', to: ['ada@example.com'], subject: mail.subject, text: mail.text }, { Authorization: 'Bearer re_key' }],
    ['postmark', 'https://api.postmarkapp.com/email', { From: 'Novan CMS <no-reply@novan.test>', To: 'ada@example.com', Subject: mail.subject, TextBody: mail.text, MessageStream: 'outbound' }, { 'X-Postmark-Server-Token': 'pm_token' }],
  ] as const)('sends through %s', async (provider, url, body, headers) => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));
    await createMailer(config(provider), fetcher).send(mail);
    expect(fetcher).toHaveBeenCalledWith(url, expect.objectContaining({ method: 'POST', headers: expect.objectContaining(headers) }));
    expect(JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual(body);
  });

  it('never throws, and sends nothing to nobody', async () => {
    const failing = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(createMailer(config('resend'), failing).send(mail)).resolves.toBeUndefined();
    await createMailer(config('resend'), failing).send({ ...mail, to: [] });
    expect(failing).toHaveBeenCalledTimes(1);
  });
});
