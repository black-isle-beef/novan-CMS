import { API_TOKEN_PREFIXES, type ApiTokenScope } from '@novan/shared-schemas';
import { createHash, randomBytes } from 'node:crypto';

/** SHA-256 of the whole token, as stored in `api_tokens.token_hash`. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** The prefix and the last four characters, e.g. `nv_del_…a1b2`. */
export function tokenHint(token: string): string {
  return `${token.slice(0, 7)}…${token.slice(-4)}`;
}

/** A new token: the prefix and 32 random bytes in base64url (256 bits), with its hash and hint. */
export function generateToken(scope: ApiTokenScope): { token: string; hash: string; hint: string } {
  const token = `${API_TOKEN_PREFIXES[scope]}${randomBytes(32).toString('base64url')}`;
  return { token, hash: hashToken(token), hint: tokenHint(token) };
}

/** The scope a token's prefix claims, or null when it is not one of ours. */
export function scopeOfToken(token: string): ApiTokenScope | null {
  for (const [scope, prefix] of Object.entries(API_TOKEN_PREFIXES) as [ApiTokenScope, string][]) {
    if (token.startsWith(prefix) && /^[A-Za-z0-9_-]{43}$/.test(token.slice(prefix.length))) return scope;
  }
  return null;
}
