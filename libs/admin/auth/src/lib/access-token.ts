import type { SpaceClaim } from '@novan/shared-schemas';

/** Claims the admin reads from the access token (set by the access token hook, 0003). Display only: the API verifies. */
export interface AccessTokenClaims {
  sub: string;
  email?: string;
  aal?: 'aal1' | 'aal2';
  agency_staff?: boolean;
  spaces?: SpaceClaim[];
}

/** Decodes a JWT payload without verifying it. Returns null for anything malformed. */
export function decodeAccessToken(token: string | null | undefined): AccessTokenClaims | null {
  const payload = token?.split('.')[1];
  if (!payload) return null;
  try {
    const base64 = payload
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(payload.length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const claims: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return typeof claims === 'object' && claims !== null && typeof (claims as AccessTokenClaims).sub === 'string'
      ? (claims as AccessTokenClaims)
      : null;
  } catch {
    return null;
  }
}
