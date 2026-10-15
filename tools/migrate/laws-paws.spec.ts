// laws-paws.spec.ts — the migration against the Law's Paws content model (apps/laws-paws-site/novan/schema): every
// entry passes the API's own publish validation, links and files resolve, and running it twice adds nothing.
import { type BlockTypeDef, buildEntrySchema } from '@novan/shared-schemas';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { fakeApi, target } from '../novan-cli/src/lib/fake-api';
import { readSchemaDir } from '../novan-cli/src/lib/schema-files';
import { seed } from '../novan-cli/src/lib/seed';
import { LAWS_PAWS_ENTRIES, LAWS_PAWS_MEDIA, withAssets } from './laws-paws.content';
import { type MediaApi, syncMedia } from './media';

const schema = readSchemaDir(resolve(import.meta.dirname, '../../apps/laws-paws-site/novan/schema'));
const assetIds = new Map(
  LAWS_PAWS_MEDIA.map((file, index) => [file.key, `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`]),
);
const altOf = new Map(LAWS_PAWS_MEDIA.map((file) => [assetIds.get(file.key), file.alt || null]));
const quiet = () => undefined;

async function migrate() {
  const fake = fakeApi({ contentTypes: schema.contentTypes, blockTypes: schema.blockTypes });
  const result = await seed(
    fake.api,
    target,
    { entries: withAssets(LAWS_PAWS_ENTRIES, assetIds) },
    { publish: true, message: 'test', log: quiet },
  );
  return { ...fake, result };
}

describe("Law's Paws content", () => {
  it('creates and publishes every page, the menu, the site settings and the not-found page', async () => {
    const { state, result } = await migrate();

    expect(result).toEqual({ created: 9, published: 9, skipped: 0 });
    expect(state.entries.map((entry) => entry.path).sort()).toEqual(
      [
        '/about',
        '/contact',
        '/cookie-policy',
        '/gallery',
        '/home',
        '/navigation',
        '/not-found',
        '/privacy',
        '/site-settings',
      ].sort(),
    );
  });

  it('passes the validation the API runs on publish, for every entry', async () => {
    const { state } = await migrate();
    const blockTypes: BlockTypeDef[] = schema.blockTypes;

    for (const entry of state.entries) {
      const type = schema.contentTypes.find((candidate) => candidate.apiId === entry.contentType);
      const result = buildEntrySchema(type?.fields ?? [], {
        blockTypes,
        assets: (id) => (altOf.has(id) ? { kind: 'image', alt: altOf.get(id) ?? null } : null),
      }).safeParse(entry.data);

      expect(result.error?.issues ?? [], `${entry.path}: ${JSON.stringify(result.error?.issues)}`).toEqual([]);
    }
  });

  it('links pages to each other by id', async () => {
    const { state } = await migrate();
    const idOf = (path: string) => state.entries.find((entry) => entry.path === path)?.id;
    // Links are translated fields, stored by locale.
    const menu = state.entries.find((entry) => entry.path === '/navigation')?.data['items'] as {
      link: Record<string, { entryId: string }>;
    }[];

    expect(menu.map((item) => item.link['en-GB'].entryId)).toEqual(
      ['/home', '/about', '/gallery', '/contact'].map(idOf),
    );
  });

  it('uses every block the pilot added', async () => {
    const used = new Set(
      JSON.stringify(LAWS_PAWS_ENTRIES)
        .match(/"_block":"[a-zA-Z]+"/g)
        ?.map((match) => match.slice(10, -1)),
    );

    expect([...used]).toEqual(expect.arrayContaining(['mediaText', 'cardGrid', 'badgeList']));
  });

  it('keeps pages that already exist when run again', async () => {
    const fake = fakeApi({ contentTypes: schema.contentTypes, blockTypes: schema.blockTypes });
    const file = { entries: withAssets(LAWS_PAWS_ENTRIES, assetIds) };
    await seed(fake.api, target, file, { publish: true, message: 'first', log: quiet });
    const calls = fake.state.calls.length;

    const again = await seed(fake.api, target, file, { publish: true, message: 'again', log: quiet });

    expect(again).toEqual({ created: 0, published: 0, skipped: 9 });
    expect(fake.state.calls).toHaveLength(calls);
  });

  it('refuses to fill a media field with a file that was not uploaded', () => {
    expect(() => withAssets(LAWS_PAWS_ENTRIES, new Map())).toThrow(/No uploaded file for "badge"/);
  });

  it('gives every file a unique key and library address', () => {
    expect(new Set(LAWS_PAWS_MEDIA.map((file) => file.key)).size).toBe(LAWS_PAWS_MEDIA.length);
    expect(new Set(LAWS_PAWS_MEDIA.map((file) => `${file.folder}/${file.source.split('/').pop()}`)).size).toBe(
      LAWS_PAWS_MEDIA.length,
    );
  });

  it('describes every photo, and keeps stock photos out of the brand folder', () => {
    for (const file of LAWS_PAWS_MEDIA.filter((candidate) => candidate.source.endsWith('.jpg'))) {
      expect(file.alt.length, file.key).toBeGreaterThan(20);
      expect(file.folder).toBe('website/stock-photos');
      expect(file.title).toMatch(/on Unsplash$/);
    }
  });
});

describe('syncMedia', () => {
  let sourceDir: string;

  beforeEach(() => {
    sourceDir = mkdtempSync(join(tmpdir(), 'laws-paws-'));
    for (const file of LAWS_PAWS_MEDIA) {
      mkdirSync(dirname(join(sourceDir, file.source)), { recursive: true });
      writeFileSync(join(sourceDir, file.source), `file ${file.key}`);
    }
  });

  afterEach(() => rmSync(sourceDir, { recursive: true, force: true }));

  /** An in-memory media library behind the three upload calls. */
  function library() {
    const assets: {
      id: string;
      filename: string;
      folder: string | null;
      alt: string | null;
      deletedAt: string | null;
    }[] = [];
    const puts: string[] = [];
    let next = 0;
    const api = {
      assets: async (_space: string, folder: string) => assets.filter((asset) => asset.folder?.startsWith(folder)),
      assetUploadUrl: async (_space: string, body: { filename: string }) => ({
        assetId: `asset-${++next}`,
        filename: body.filename,
        mime: 'image/png',
        uploadUrl: `https://storage.test/${next}`,
        maxBytes: 1e7,
      }),
      putFile: async (upload: { filename: string }, file: Blob) => {
        puts.push(`${upload.filename} ${file.size}`);
      },
      completeAssetUpload: async (
        _space: string,
        body: { assetId: string; filename: string; folder?: string | null; alt?: string | null },
      ) => {
        const asset = {
          id: body.assetId,
          filename: body.filename,
          folder: body.folder ?? null,
          alt: body.alt ?? null,
          deletedAt: null,
        };
        assets.push(asset);
        return asset;
      },
    };
    return { api: api as unknown as MediaApi, assets, puts };
  }

  it('uploads each file once, with its folder and alt text', async () => {
    const { api, assets, puts } = library();

    const ids = await syncMedia(api, target.spaceId, LAWS_PAWS_MEDIA, { sourceDir, dryRun: false, log: quiet });

    expect(puts).toHaveLength(LAWS_PAWS_MEDIA.length);
    expect(ids.size).toBe(LAWS_PAWS_MEDIA.length);
    expect(assets.find((asset) => asset.id === ids.get('badge'))).toMatchObject({
      folder: 'website/brand',
      alt: "The Law's Paws badge logo",
    });
    expect(assets.find((asset) => asset.id === ids.get('favicon'))?.alt).toBeNull();
  });

  it('uploads nothing the second time, and answers the same ids', async () => {
    const { api, puts } = library();
    const first = await syncMedia(api, target.spaceId, LAWS_PAWS_MEDIA, { sourceDir, dryRun: false, log: quiet });

    const second = await syncMedia(api, target.spaceId, LAWS_PAWS_MEDIA, { sourceDir, dryRun: false, log: quiet });

    expect(puts).toHaveLength(LAWS_PAWS_MEDIA.length);
    expect(second).toEqual(first);
  });

  it('uploads again a file that was moved to the bin', async () => {
    const { api, assets, puts } = library();
    await syncMedia(api, target.spaceId, LAWS_PAWS_MEDIA, { sourceDir, dryRun: false, log: quiet });
    assets[0].deletedAt = '2026-10-14T00:00:00Z';

    await syncMedia(api, target.spaceId, LAWS_PAWS_MEDIA, { sourceDir, dryRun: false, log: quiet });

    expect(puts).toHaveLength(LAWS_PAWS_MEDIA.length + 1);
  });

  it('uploads nothing in a dry run', async () => {
    const { api, puts } = library();

    await syncMedia(api, target.spaceId, LAWS_PAWS_MEDIA, { sourceDir, dryRun: true, log: quiet });

    expect(puts).toEqual([]);
  });
});
