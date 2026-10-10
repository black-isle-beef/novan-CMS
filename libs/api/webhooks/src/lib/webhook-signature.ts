import { createHmac, timingSafeEqual } from 'node:crypto';

/** The header a webhook request is signed in: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`. */
export const SIGNATURE_HEADER = 'X-Novan-Signature';

/** How far a signature's timestamp may be from now before a receiver should refuse it (replays). */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

/** Signs `body` (the exact bytes sent) at `timestamp` (unix seconds) with the webhook's secret. */
export function signWebhook(secret: string, body: string, timestamp: number): string {
  const digest = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

/**
 * Whether `header` is a valid signature of `body` made within the tolerance of `now` (unix seconds). The same check
 * receivers make (docs/webhooks.md).
 */
export function verifyWebhookSignature(
  secret: string,
  body: string,
  header: string | null | undefined,
  now = Math.floor(Date.now() / 1000),
  toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS,
): boolean {
  const parts = new Map((header ?? '').split(',').map((part) => part.trim().split('=', 2) as [string, string]));
  const timestamp = Number(parts.get('t'));
  const given = parts.get('v1') ?? '';
  if (!Number.isInteger(timestamp) || Math.abs(now - timestamp) > toleranceSeconds || !/^[0-9a-f]{64}$/.test(given)) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest();
  return timingSafeEqual(expected, Buffer.from(given, 'hex'));
}
