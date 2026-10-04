import { ContentEvents, type EntryPublishedEvent, type EntryUnpublishedEvent } from '@novan/api-content';
import type { DbService } from '@novan/api-db';
import { MediaEvents } from '@novan/api-media';
import { CachePurge } from './cache-purge.service';
import { CloudflareClient, CloudflarePurgeError } from './cloudflare-client';

const spaceId = 'space-1';
const environmentId = 'env-1';
const entryId = 'entry-1';

const published: EntryPublishedEvent = {
  type: 'entry.published',
  spaceId,
  environmentId,
  entryId,
  contentType: 'article',
  locale: 'en-GB',
  path: '/blog/hello',
  cacheTags: [`entry:${entryId}`, `type:${environmentId}:article`],
  actorId: 'user-1',
  versionId: 'version-1',
  publishedAt: '2026-10-04T09:00:00Z',
};

/** A Cloudflare client whose calls are recorded instead of sent. */
function mockCloudflare(enabled = true) {
  const client = new CloudflareClient({ zoneId: enabled ? 'zone' : undefined, apiUrl: 'https://cloudflare.test' });
  const purgeTags = vi.spyOn(client, 'purgeTags').mockResolvedValue();
  const purgeUrls = vi.spyOn(client, 'purgeUrls').mockResolvedValue();
  return { client, purgeTags, purgeUrls };
}

/** Just enough of DbService for reading `spaces.settings`. */
function dbWithSettings(settings: unknown): DbService {
  const query = { from: () => query, where: async () => [{ settings }] };
  return { serviceDb: { select: () => query } } as unknown as DbService;
}

function setup(options: { enabled?: boolean; settings?: unknown } = {}) {
  const cloudflare = mockCloudflare(options.enabled);
  const content = new ContentEvents();
  const media = new MediaEvents();
  const purge = new CachePurge(cloudflare.client, content, media, dbWithSettings(options.settings ?? {}));
  purge.onModuleInit();
  return { ...cloudflare, content, media, purge };
}

describe('CachePurge', () => {
  it('purges the entry, its type, the unfiltered lists and the sitemap on publish', async () => {
    const { purge, purgeTags, purgeUrls } = setup();
    await purge.contentChanged(published);
    expect(purgeTags).toHaveBeenCalledExactlyOnceWith([
      `entry:${entryId}`,
      `type:${environmentId}:article`,
      `entries:${environmentId}`,
      `sitemap:${environmentId}`,
      `overflow:${spaceId}`,
    ]);
    expect(purgeUrls).not.toHaveBeenCalled();
  });

  it('purges the same tags when an entry is unpublished', async () => {
    const { purge, purgeTags } = setup();
    const { versionId: _v, publishedAt: _p, ...rest } = published;
    const unpublished: EntryUnpublishedEvent = { ...rest, type: 'entry.unpublished' };
    await purge.contentChanged(unpublished);
    expect(purgeTags.mock.calls[0][0]).toContain(`entry:${entryId}`);
    expect(purgeTags.mock.calls[0][0]).toContain(`sitemap:${environmentId}`);
  });

  it('listens to the content and media buses', async () => {
    const { content, media, purgeTags } = setup();
    content.emit(published);
    media.emit({ type: 'asset.replaced', spaceId, assetId: 'asset-1', cacheTags: ['asset:asset-1'], actorId: 'user-1' });
    await vi.waitFor(() => expect(purgeTags).toHaveBeenCalledTimes(2));
    expect(purgeTags).toHaveBeenCalledWith(['asset:asset-1', `overflow:${spaceId}`]);
  });

  it("falls back to the page's URLs on the space's domains when purge by tag is refused", async () => {
    const { purge, purgeTags, purgeUrls } = setup({
      settings: { domains: ['https://www.example.com/', 'http://example.org', 'javascript:alert(1)', 42] },
    });
    purgeTags.mockRejectedValue(new CloudflarePurgeError('Purge by tag is not available on this plan'));
    await purge.contentChanged(published);
    expect(purgeUrls).toHaveBeenCalledExactlyOnceWith([
      'https://www.example.com/blog/hello',
      'https://www.example.com/sitemap.xml',
      'http://example.org/blog/hello',
      'http://example.org/sitemap.xml',
    ]);
  });

  it('purges the home page as /', async () => {
    const { purge, purgeTags, purgeUrls } = setup({ settings: { domains: ['https://example.com'] } });
    purgeTags.mockRejectedValue(new Error('down'));
    await purge.contentChanged({ ...published, path: '/home' });
    expect(purgeUrls.mock.calls[0][0]).toEqual(['https://example.com/', 'https://example.com/sitemap.xml']);
  });

  it('sends at most 30 tags or URLs a request', async () => {
    const { purge, purgeTags } = setup();
    await purge.contentChanged({ ...published, cacheTags: Array.from({ length: 40 }, (_, i) => `entry:${i}`) });
    expect(purgeTags).toHaveBeenCalledTimes(2);
    expect(purgeTags.mock.calls[0][0]).toHaveLength(30);
    // 40 entry tags plus the lists, sitemap and overflow tags.
    expect(purgeTags.mock.calls[1][0]).toHaveLength(13);
  });

  it('never throws, even when both purges fail', async () => {
    const { purge, purgeTags, purgeUrls } = setup({ settings: { domains: ['https://example.com'] } });
    purgeTags.mockRejectedValue(new Error('down'));
    purgeUrls.mockRejectedValue(new Error('still down'));
    await expect(purge.contentChanged(published)).resolves.toBeUndefined();
  });

  it('purges every response of a revoked token', async () => {
    const { purge, purgeTags } = setup();
    await purge.tokenRevoked('token-1');
    expect(purgeTags).toHaveBeenCalledExactlyOnceWith(['token:token-1']);
  });

  it('does nothing without CLOUDFLARE_ZONE_ID (local)', async () => {
    const { purge, purgeTags, purgeUrls } = setup({ enabled: false });
    await purge.contentChanged(published);
    await purge.tokenRevoked('token-1');
    expect(purgeTags).not.toHaveBeenCalled();
    expect(purgeUrls).not.toHaveBeenCalled();
  });
});

describe('CloudflareClient', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts tags to the zone purge endpoint with the API token', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const client = new CloudflareClient({ zoneId: 'zone-1', apiToken: 'cf-token', apiUrl: 'https://api.cloudflare.test/client/v4' });
    await client.purgeTags(['entry:1']);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.cloudflare.test/client/v4/zones/zone-1/purge_cache',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer cf-token' }),
        body: JSON.stringify({ tags: ['entry:1'] }),
      }),
    );
  });

  it("raises Cloudflare's reason when the purge is refused", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false, errors: [{ message: 'Not entitled' }] }), { status: 400 })),
    );
    const client = new CloudflareClient({ zoneId: 'zone-1', apiUrl: 'https://api.cloudflare.test' });
    await expect(client.purgeUrls(['https://example.com/'])).rejects.toThrow('Not entitled');
  });
});
