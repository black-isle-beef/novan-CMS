import { Logger } from '@nestjs/common';

/** An email to send: plain text, with an optional HTML version. */
export interface Mail {
  to: readonly string[];
  subject: string;
  text: string;
  html?: string;
}

/**
 * Sends email (docs/build/13-workflow-publishing.md). Providers are chosen with `MAIL_PROVIDER`; tests provide
 * {@link MemoryMailer}. Sending never throws: a lost notification must not undo the change that caused it.
 */
export abstract class Mailer {
  abstract send(mail: Mail): Promise<void>;
}

export const MAIL_PROVIDERS = ['log', 'mailpit', 'resend', 'postmark'] as const;
export type MailProvider = (typeof MAIL_PROVIDERS)[number];

export interface MailerConfig {
  provider: MailProvider;
  /** `Name <address>` or an address. */
  from: string;
  /** Mailpit's address (local Supabase's inbox). */
  mailpitUrl: string;
  resendApiKey: string;
  postmarkToken: string;
}

/** `MAIL_PROVIDER` (Mailpit locally, `log` in production until one is set), `MAIL_FROM` and the provider's key. */
export function mailerConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MailerConfig {
  const named = env['MAIL_PROVIDER'] as MailProvider | undefined;
  const provider = named && MAIL_PROVIDERS.includes(named) ? named : env['NODE_ENV'] === 'production' ? 'log' : 'mailpit';
  return {
    provider,
    from: env['MAIL_FROM'] || 'Novan CMS <no-reply@novan.test>',
    mailpitUrl: (env['MAILPIT_URL'] || 'http://127.0.0.1:54324').replace(/\/+$/, ''),
    resendApiKey: env['RESEND_API_KEY'] ?? '',
    postmarkToken: env['POSTMARK_SERVER_TOKEN'] ?? '',
  };
}

/** The mailer `config` names. */
export function createMailer(config: MailerConfig, fetcher: typeof fetch = fetch): Mailer {
  switch (config.provider) {
    case 'mailpit':
      return new HttpMailer('Mailpit', (mail) => {
        const from = address(config.from);
        return fetcher(`${config.mailpitUrl}/api/v1/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            From: { Email: from.email, Name: from.name },
            To: mail.to.map((email) => ({ Email: email })),
            Subject: mail.subject,
            Text: mail.text,
            ...(mail.html ? { HTML: mail.html } : {}),
          }),
        });
      });
    case 'resend':
      return new HttpMailer('Resend', (mail) =>
        fetcher('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.resendApiKey}` },
          body: JSON.stringify({ from: config.from, to: mail.to, subject: mail.subject, text: mail.text, ...(mail.html ? { html: mail.html } : {}) }),
        }),
      );
    case 'postmark':
      return new HttpMailer('Postmark', (mail) =>
        fetcher('https://api.postmarkapp.com/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Postmark-Server-Token': config.postmarkToken },
          body: JSON.stringify({
            From: config.from,
            To: mail.to.join(','),
            Subject: mail.subject,
            TextBody: mail.text,
            ...(mail.html ? { HtmlBody: mail.html } : {}),
            MessageStream: 'outbound',
          }),
        }),
      );
    case 'log':
      return new LogMailer();
  }
}

/** Keeps what was sent, for tests. */
export class MemoryMailer extends Mailer {
  readonly sent: Mail[] = [];

  send(mail: Mail): Promise<void> {
    this.sent.push(mail);
    return Promise.resolve();
  }
}

/** Writes who would have been emailed, without the content, when no provider is set. */
class LogMailer extends Mailer {
  private readonly logger = new Logger('Mailer');

  send(mail: Mail): Promise<void> {
    this.logger.log(`Not sent (no MAIL_PROVIDER): "${mail.subject}" to ${mail.to.length} recipient(s).`);
    return Promise.resolve();
  }
}

class HttpMailer extends Mailer {
  private readonly logger = new Logger('Mailer');

  constructor(
    private readonly provider: string,
    private readonly post: (mail: Mail) => Promise<Response>,
  ) {
    super();
  }

  async send(mail: Mail): Promise<void> {
    if (!mail.to.length) return;
    try {
      const response = await this.post(mail);
      if (!response.ok) this.logger.warn(`${this.provider} refused "${mail.subject}": ${response.status}`);
    } catch (error) {
      this.logger.warn(`${this.provider} could not be reached for "${mail.subject}": ${String(error)}`);
    }
  }
}

/** `Novan CMS <no-reply@x>` → name and address. */
function address(value: string): { name: string; email: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(value);
  return match ? { name: match[1], email: match[2] } : { name: '', email: value.trim() };
}
