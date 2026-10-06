import { PREVIEW_TOKEN_TTL_SECONDS } from '@novan/shared-schemas';
import { PreviewSigner, previewSignerConfigFromEnv } from './preview-signer';

const claims = {
  spaceId: '00000000-0000-4000-8000-00000000000a',
  environmentId: '00000000-0000-4000-8000-00000000000b',
  entryId: '00000000-0000-4000-8000-00000000000c',
};
const now = Date.UTC(2026, 9, 6, 12, 0, 0);
const signer = new PreviewSigner({ secret: 's'.repeat(32), adminOrigin: 'https://admin.novan.test' });

describe('PreviewSigner', () => {
  it('signs tokens it accepts for 15 minutes', () => {
    const { token, claims: signed } = signer.sign(claims, now);
    expect(signed.expiresAt).toBe(now / 1000 + PREVIEW_TOKEN_TTL_SECONDS);
    expect(signer.verify(token, now)).toEqual(signed);
    expect(signer.verify(token, now + (PREVIEW_TOKEN_TTL_SECONDS - 1) * 1000)).toEqual(signed);
    expect(signer.verify(token, now + PREVIEW_TOKEN_TTL_SECONDS * 1000)).toBeNull();
  });

  it('refuses tokens that were changed or signed with another secret', () => {
    const { token } = signer.sign(claims, now);
    const [payload, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ v: 1, s: claims.spaceId, n: claims.environmentId, e: claims.entryId, x: 9e9 })).toString(
      'base64url',
    );
    const other = new PreviewSigner({ secret: 't'.repeat(32), adminOrigin: 'https://admin.novan.test' });
    for (const bad of [
      `${forged}.${signature}`,
      `${payload}.${signature.slice(0, -1)}A`,
      `${payload}.`,
      payload,
      `${token}.extra`,
      other.sign(claims, now).token,
      'x'.repeat(2000),
      '',
    ]) {
      expect(signer.verify(bad, now)).toBeNull();
    }
  });

  it('refuses a correctly signed payload that is not a preview token', () => {
    const sign = (body: unknown) => {
      const payload = Buffer.from(JSON.stringify(body)).toString('base64url');
      // Reach the HMAC through a token signed for these bytes.
      const signature = (signer as unknown as { signature(p: string): string }).signature(payload);
      return `${payload}.${signature}`;
    };
    expect(signer.verify(sign({ v: 2, s: claims.spaceId, n: claims.environmentId, e: claims.entryId, x: 9e9 }), now)).toBeNull();
    expect(signer.verify(sign({ v: 1, s: 'space', n: claims.environmentId, e: claims.entryId, x: 9e9 }), now)).toBeNull();
    expect(signer.verify(sign([1, 2]), now)).toBeNull();
  });

  it('needs a long secret in production, and makes one up elsewhere', () => {
    expect(() => previewSignerConfigFromEnv({ NODE_ENV: 'production' })).toThrow(/PREVIEW_SIGNING_SECRET/);
    expect(() => previewSignerConfigFromEnv({ PREVIEW_SIGNING_SECRET: 'short' })).toThrow(/too short/);
    const made = previewSignerConfigFromEnv({ ADMIN_URL: 'https://admin.example.com/path' });
    expect(made.secret.length).toBeGreaterThanOrEqual(32);
    expect(made.adminOrigin).toBe('https://admin.example.com');
    expect(previewSignerConfigFromEnv({ PREVIEW_SIGNING_SECRET: 'k'.repeat(40) }).adminOrigin).toBe('http://localhost:4200');
  });
});
