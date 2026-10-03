import { Inject, Injectable } from '@nestjs/common';
import type { JwtClaims } from '@novan/api-db';
import { createRemoteJWKSet, decodeProtectedHeader, type JWTVerifyGetKey, jwtVerify } from 'jose';

export interface JwtVerifierConfig {
  /** Symmetric secret for HS256 tokens (`supabase status`: JWT_SECRET). */
  secret?: string;
  /** JWKS endpoint for asymmetric signing keys (ES256/RS256). */
  jwksUrl?: string;
  /** Expected `iss`, e.g. `http://127.0.0.1:54321/auth/v1`. Skipped when unset. */
  issuer?: string;
}

export const JWT_VERIFIER_CONFIG = Symbol('JWT_VERIFIER_CONFIG');

export function jwtVerifierConfigFromEnv(env: NodeJS.ProcessEnv = process.env): JwtVerifierConfig {
  const supabaseUrl = env['SUPABASE_URL']?.replace(/\/$/, '');
  return {
    secret: env['SUPABASE_JWT_SECRET'] || undefined,
    jwksUrl: env['SUPABASE_JWKS_URL'] || (supabaseUrl ? `${supabaseUrl}/auth/v1/.well-known/jwks.json` : undefined),
    issuer: supabaseUrl ? `${supabaseUrl}/auth/v1` : undefined,
  };
}

/**
 * Verifies Supabase access tokens. HS256 tokens are checked against the JWT secret; anything else
 * against the project's JWKS. Only signed-in user tokens pass (`aud: authenticated`, a `sub`).
 */
@Injectable()
export class JwtVerifier {
  private readonly secret?: Uint8Array;
  private readonly jwks?: JWTVerifyGetKey;

  constructor(@Inject(JWT_VERIFIER_CONFIG) private readonly config: JwtVerifierConfig) {
    if (config.secret) this.secret = new TextEncoder().encode(config.secret);
    if (config.jwksUrl) this.jwks = createRemoteJWKSet(new URL(config.jwksUrl));
  }

  /** Returns the verified claims, or throws if the token is invalid, expired or not a user token. */
  async verify(token: string): Promise<JwtClaims> {
    const { alg } = decodeProtectedHeader(token);
    const options = { audience: 'authenticated', issuer: this.config.issuer };

    let payload: JwtClaims;
    if (alg === 'HS256') {
      if (!this.secret) throw new Error('HS256 token but SUPABASE_JWT_SECRET is not set');
      ({ payload } = await jwtVerify(token, this.secret, { ...options, algorithms: ['HS256'] }));
    } else {
      if (!this.jwks) throw new Error('Asymmetric token but no JWKS URL is configured');
      ({ payload } = await jwtVerify(token, this.jwks, { ...options, algorithms: ['ES256', 'RS256'] }));
    }

    if (typeof payload.sub !== 'string' || payload['role'] !== 'authenticated') {
      throw new Error('Not a signed-in user token');
    }
    return payload;
  }
}
