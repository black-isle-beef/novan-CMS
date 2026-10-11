import type { BlockTypeDef, FieldDef } from '@novan/shared-schemas';
import { cacheTagHeader } from './cache-headers.interceptor';
import { DROP, mapEntryData } from './entry-walker';
import { clientIp, rateLimitsFromEnv } from './rate-limit';
import { generateToken, hashToken, scopeOfToken, tokenHint } from './token-secret';

describe('tokens', () => {
  it('start with the scope prefix and carry 256 random bits', () => {
    const { token, hash, hint } = generateToken('delivery');
    expect(token).toMatch(/^nv_del_[A-Za-z0-9_-]{43}$/);
    expect(hash).toBe(hashToken(token));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hint).toBe(`nv_del_…${token.slice(-4)}`);
    expect(generateToken('preview').token).toMatch(/^nv_pre_/);
    expect(generateToken('delivery').token).not.toBe(token);
  });

  it('are recognised by prefix and shape only', () => {
    expect(scopeOfToken(generateToken('delivery').token)).toBe('delivery');
    expect(scopeOfToken(generateToken('preview').token)).toBe('preview');
    expect(scopeOfToken('nv_del_short')).toBeNull();
    expect(scopeOfToken(`nv_adm_${'a'.repeat(43)}`)).toBeNull();
    expect(scopeOfToken('eyJhbGciOiJIUzI1NiJ9.e30.x')).toBeNull();
    expect(tokenHint(`nv_pre_${'a'.repeat(39)}wxyz`)).toBe('nv_pre_…wxyz');
  });
});

describe('cacheTagHeader', () => {
  it("adds the token's tag and drops duplicates", () => {
    expect(cacheTagHeader(['space:s', 'entry:e', 'entry:e'], 't', 's')).toBe('token:t,space:s,entry:e');
  });

  it('keeps under the CDN limit by falling back to the space overflow tag', () => {
    const tags = Array.from({ length: 1000 }, (_, i) => `entry:00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const header = cacheTagHeader(['space:s', ...tags], 't', 's');
    expect(header.length).toBeLessThanOrEqual(15_000);
    expect(header.startsWith('overflow:s,token:t,space:s,entry:')).toBe(true);
  });
});

describe('rateLimitsFromEnv', () => {
  const defaults = { delivery: 50, preview: 10, notFound: 60, form: 5, formToken: 120 };

  it('defaults to 50 a second for delivery and 10 for preview, 5 forms a minute a visitor, and takes positive whole overrides', () => {
    expect(rateLimitsFromEnv({})).toEqual(defaults);
    expect(
      rateLimitsFromEnv({ DELIVERY_RATE_LIMIT: '5000', PREVIEW_RATE_LIMIT: 'lots', NOT_FOUND_RATE_LIMIT: '5', FORM_RATE_LIMIT: '2', FORM_TOKEN_RATE_LIMIT: '0' }),
    ).toEqual({ ...defaults, delivery: 5000, notFound: 5, form: 2 });
    expect(rateLimitsFromEnv({ DELIVERY_RATE_LIMIT: '-1' })).toEqual(defaults);
  });

  it('takes the visitor\'s address from the site\'s server when it is an address', () => {
    expect(clientIp({ headers: { 'x-novan-client-ip': '203.0.113.9' }, ip: '10.0.0.1' })).toBe('203.0.113.9');
    expect(clientIp({ headers: { 'x-novan-client-ip': 'not-an-ip' }, ip: '10.0.0.1' })).toBe('10.0.0.1');
    expect(clientIp({ headers: {}, ip: undefined })).toBeNull();
  });
});

describe('mapEntryData', () => {
  const field = (def: Partial<FieldDef> & Pick<FieldDef, 'apiId' | 'type'>) =>
    ({ id: def.apiId, label: def.apiId, required: false, localised: false, ...def }) as FieldDef;

  const fields: FieldDef[] = [
    field({ apiId: 'title', type: 'text' }),
    field({ apiId: 'author', type: 'reference' }),
    field({ apiId: 'related', type: 'reference', multiple: true } as Partial<FieldDef> & Pick<FieldDef, 'apiId' | 'type'>),
    field({ apiId: 'cta', type: 'link' }),
    field({ apiId: 'seo', type: 'group', fields: [field({ apiId: 'image', type: 'media' })] } as never),
    field({ apiId: 'body', type: 'blocks' }),
  ];
  const blockTypes = new Map<string, BlockTypeDef>([
    ['gallery', { apiId: 'gallery', fields: [field({ apiId: 'images', type: 'media', multiple: true } as never)], allowedChildren: ['card'] }],
    ['card', { apiId: 'card', fields: [field({ apiId: 'link', type: 'reference' })] }],
  ]);

  it('replaces references, media and links through groups, blocks and children, dropping what is gone', () => {
    const data = {
      title: 'Hello',
      author: 'a',
      related: ['b', 'gone', 'c'],
      cta: { type: 'internal', entryId: 'b' },
      seo: { image: { assetId: 'missing' } },
      body: [
        {
          _uid: 'u1',
          _block: 'gallery',
          images: [{ assetId: 'x' }, { assetId: 'missing' }],
          children: [{ _uid: 'u2', _block: 'card', link: 'gone' }],
        },
      ],
    };
    const result = mapEntryData(fields, data, blockTypes, {
      reference: (id) => (id === 'gone' ? DROP : `ref:${id}`),
      media: (item) => (item.assetId === 'missing' ? DROP : `asset:${item.assetId}`),
      link: (link) => ({ ...link, path: '/b' }),
    });
    expect(result).toEqual({
      title: 'Hello',
      author: 'ref:a',
      related: ['ref:b', 'ref:c'],
      cta: { type: 'internal', entryId: 'b', path: '/b' },
      seo: { image: null },
      body: [{ _uid: 'u1', _block: 'gallery', images: ['asset:x'], children: [{ _uid: 'u2', _block: 'card', link: null }] }],
    });
    // The input is left as it was.
    expect(data.related).toEqual(['b', 'gone', 'c']);
  });

  it('keeps values of unexpected shapes and unknown blocks as they are', () => {
    const data = { author: 42, related: 'b', body: [{ _uid: 'u', _block: 'unknown', author: 'a' }, 'text'] };
    const result = mapEntryData(fields, data, blockTypes, { reference: () => DROP });
    expect(result).toEqual(data);
  });

  it('leaves out blocks the visitor drops, with their children', () => {
    const data = {
      body: [
        { _uid: 'u1', _block: 'gallery', children: [{ _uid: 'u2', _block: 'card', _hidden: true }, { _uid: 'u3', _block: 'card' }] },
        { _uid: 'u4', _block: 'gallery', _hidden: true, children: [{ _uid: 'u5', _block: 'card' }] },
      ],
    };
    const result = mapEntryData(fields, data, blockTypes, { block: (node) => (node._hidden ? DROP : node) });
    expect(result).toEqual({ body: [{ _uid: 'u1', _block: 'gallery', children: [{ _uid: 'u3', _block: 'card' }] }] });
  });
});
