import { Inject, Injectable } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { SIGNATURE_HEADER, signWebhook } from './webhook-signature';

export const WEBHOOKS_CONFIG = Symbol('WEBHOOKS_CONFIG');

export interface WebhooksConfig {
  /**
   * Whether webhooks may call private, loopback and link-local addresses. Off in production, so a webhook cannot be
   * used to reach the API's own network (`WEBHOOKS_ALLOW_PRIVATE_URLS`, on elsewhere for local receivers).
   */
  allowPrivateUrls: boolean;
  /** How long a receiver has to answer. */
  timeoutMs: number;
}

export function webhooksConfigFromEnv(env: NodeJS.ProcessEnv = process.env): WebhooksConfig {
  const allow = env['WEBHOOKS_ALLOW_PRIVATE_URLS'];
  return {
    allowPrivateUrls: allow === undefined || allow === '' ? env['NODE_ENV'] !== 'production' : allow === 'true',
    timeoutMs: 10_000,
  };
}

/** What a receiver said. */
export interface WebhookResponse {
  status: number;
}

/** A webhook URL that may never be called (a private address in production). Retrying will not help. */
export class UnsafeWebhookUrlError extends Error {
  override readonly name = 'UnsafeWebhookUrlError';
}

/**
 * POSTs signed webhook requests. Redirects are not followed (they could lead anywhere), and in production the host must
 * resolve to public addresses only.
 */
@Injectable()
export class WebhookSender {
  private readonly fetcher: typeof fetch = (input, init) => fetch(input, init);

  constructor(@Inject(WEBHOOKS_CONFIG) private readonly config: WebhooksConfig) {}

  async send(url: string, secret: string, body: string, headers: Record<string, string>): Promise<WebhookResponse> {
    await this.checkUrl(url);
    const timestamp = Math.floor(Date.now() / 1000);
    const response = await this.fetcher(url, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(this.config.timeoutMs),
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Novan-Webhooks/1',
        [SIGNATURE_HEADER]: signWebhook(secret, body, timestamp),
        ...headers,
      },
      body,
    });
    // The receiver's answer is not needed; read it so the connection is released.
    await response.arrayBuffer().catch(() => undefined);
    return { status: response.status };
  }

  /** Refuses URLs that are not http(s), or (unless allowed) that resolve to a private address. */
  async checkUrl(value: string): Promise<void> {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new UnsafeWebhookUrlError('A webhook calls an http or https address.');
    if (this.config.allowPrivateUrls) return;
    if (url.protocol !== 'https:') throw new UnsafeWebhookUrlError('A webhook must use https.');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
    if (!addresses.length || addresses.some(isPrivateAddress)) {
      throw new UnsafeWebhookUrlError('A webhook cannot call a private or local network address.');
    }
  }
}

/** Loopback, private, link-local, carrier-grade NAT, unspecified and unique-local addresses (IPv4 and IPv6). */
export function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  const ip = mapped ? mapped[1] : address;
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const lower = ip.toLowerCase();
  return lower === '::' || lower === '::1' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
}
