import { Inject, Injectable, Logger } from '@nestjs/common';
import { PREVIEW_TOKEN_TTL_SECONDS } from '@novan/shared-schemas';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** What a signed preview token allows: drafts of one page of one environment, until it expires. */
export interface PreviewClaims {
  spaceId: string;
  environmentId: string;
  entryId: string;
  /** Seconds since the epoch. */
  expiresAt: number;
}

export interface PreviewSignerConfig {
  /** `PREVIEW_SIGNING_SECRET`: at least 32 characters, the same on every API instance. */
  secret: string;
  /** The admin's origin (from `ADMIN_URL`), told to sites so their bridge trusts only it. */
  adminOrigin: string;
}

export const PREVIEW_SIGNER_CONFIG = Symbol('PREVIEW_SIGNER_CONFIG');

const MIN_SECRET = 32;
const MAX_TOKEN = 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reads the signer's settings. Without `PREVIEW_SIGNING_SECRET` a random secret is made for this process,
 * which is fine for one local API but means tokens stop working on restart and are not shared between
 * instances, so production refuses to start without one.
 */
export function previewSignerConfigFromEnv(env: NodeJS.ProcessEnv = process.env): PreviewSignerConfig {
  const adminOrigin = new URL(env['ADMIN_URL'] || 'http://localhost:4200').origin;
  const secret = env['PREVIEW_SIGNING_SECRET'] ?? '';
  if (secret.length >= MIN_SECRET) return { secret, adminOrigin };
  if (env['NODE_ENV'] === 'production') {
    throw new Error(`PREVIEW_SIGNING_SECRET must be set to at least ${MIN_SECRET} characters.`);
  }
  if (secret) throw new Error(`PREVIEW_SIGNING_SECRET is too short: use at least ${MIN_SECRET} characters.`);
  new Logger('PreviewSigner').warn('PREVIEW_SIGNING_SECRET is not set; preview links last only until the API restarts.');
  return { secret: randomBytes(32).toString('base64url'), adminOrigin };
}

/**
 * Signs and checks the short-lived tokens the admin opens previews with: `<payload>.<signature>`, both
 * base64url, the signature an HMAC-SHA256 of the payload. They are bearer tokens for one page's drafts, so
 * they last {@link PREVIEW_TOKEN_TTL_SECONDS} and the admin refreshes them.
 */
@Injectable()
export class PreviewSigner {
  private readonly key: Buffer;

  constructor(@Inject(PREVIEW_SIGNER_CONFIG) private readonly config: PreviewSignerConfig) {
    this.key = Buffer.from(config.secret, 'utf8');
  }

  get adminOrigin(): string {
    return this.config.adminOrigin;
  }

  sign(claims: Omit<PreviewClaims, 'expiresAt'>, now = Date.now()): { token: string; claims: PreviewClaims } {
    const full: PreviewClaims = { ...claims, expiresAt: Math.floor(now / 1000) + PREVIEW_TOKEN_TTL_SECONDS };
    const payload = Buffer.from(
      JSON.stringify({ v: 1, s: full.spaceId, n: full.environmentId, e: full.entryId, x: full.expiresAt }),
      'utf8',
    ).toString('base64url');
    return { token: `${payload}.${this.signature(payload)}`, claims: full };
  }

  /** The token's claims, or null when it is malformed, tampered with or expired. */
  verify(token: string, now = Date.now()): PreviewClaims | null {
    if (token.length > MAX_TOKEN) return null;
    const [payload, signature, ...rest] = token.split('.');
    if (!payload || !signature || rest.length) return null;
    const expected = Buffer.from(this.signature(payload), 'utf8');
    const given = Buffer.from(signature, 'utf8');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

    let body: unknown;
    try {
      body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    if (typeof body !== 'object' || body === null) return null;
    const { v, s, n, e, x } = body as Record<string, unknown>;
    if (v !== 1 || !isUuid(s) || !isUuid(n) || !isUuid(e) || typeof x !== 'number' || !Number.isInteger(x)) return null;
    if (x * 1000 <= now) return null;
    return { spaceId: s, environmentId: n, entryId: e, expiresAt: x };
  }

  private signature(payload: string): string {
    return createHmac('sha256', this.key).update(payload, 'utf8').digest('base64url');
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}
