// The starter kits (kits/) against the blocks manifest, the starter site and the entry validation publishing uses,
// so a kit always pushes and seeds cleanly.
import { buildEntrySchema } from '@novan/shared-schemas';
import { resolve } from 'node:path';
import { readManifest } from './blocks';
import { canonical } from './diff';
import { kitNames, loadKit } from './kits';
import { referencesOf } from './push';
import { readSchemaDir } from './schema-files';
import { resolveRefs, toStoredData } from './seed';

const root = resolve(import.meta.dirname, '../../../..');
const kitsDir = resolve(root, 'kits');
const manifest = readManifest(resolve(root, 'libs/blocks/block-types.json'));

describe('starter kits', () => {
  it('has the brochure, blog and portfolio kits', () => {
    expect(kitNames(kitsDir)).toEqual(['blog', 'brochure', 'portfolio']);
  });

  it("matches the starter site's schema to the brochure kit", () => {
    expect(canonical(readSchemaDir(resolve(root, 'apps/starter-site/novan/schema')))).toBe(canonical(loadKit(kitsDir, 'brochure').schema));
  });

  describe.each(['brochure', 'blog', 'portfolio'])('%s', (name) => {
    const kit = loadKit(kitsDir, name);
    const { contentTypes, blockTypes } = kit.schema;

    it('has a description', () => {
      expect(kit.description.length).toBeGreaterThan(10);
    });

    it('uses the blocks exactly as @novan/blocks defines them', () => {
      for (const type of blockTypes) {
        expect(canonical(type), type.apiId).toBe(canonical(manifest.find((candidate) => candidate.apiId === type.apiId)));
      }
    });

    it('points only at types it has', () => {
      const has = { contentType: new Set(contentTypes.map((t) => t.apiId)), blockType: new Set(blockTypes.map((t) => t.apiId)) };
      for (const type of contentTypes) for (const ref of referencesOf('contentType', type)) expect(has[ref.kind].has(ref.apiId), `${type.apiId} → ${ref.apiId}`).toBe(true);
      for (const type of blockTypes) for (const ref of referencesOf('blockType', type)) expect(has[ref.kind].has(ref.apiId), `${type.apiId} → ${ref.apiId}`).toBe(true);
    });

    it('allows every block it has on pages', () => {
      const page = contentTypes.find((type) => type.apiId === 'page');
      const body = page?.fields.find((field) => field.apiId === 'body');
      expect(body?.type === 'blocks' ? [...body.allowedBlocks].sort() : []).toEqual(blockTypes.map((type) => type.apiId).sort());
    });

    it('seeds the pages every site needs', () => {
      const types = kit.seed.entries.map((entry) => entry.contentType);
      expect(types).toEqual(expect.arrayContaining(['navigation', 'siteSettings', 'notFound']));
      expect(kit.seed.entries.find((entry) => entry.contentType === 'page' && entry.slug === 'home' && !entry.folder)).toBeDefined();
    });

    it('seeds entries with unique keys and addresses, in folders it creates', () => {
      const keys = kit.seed.entries.map((entry) => entry.key);
      expect(new Set(keys).size).toBe(keys.length);
      const addresses = kit.seed.entries.map((entry) => `${entry.contentType}:${entry.folder ?? ''}/${entry.slug}`);
      expect(new Set(addresses).size).toBe(addresses.length);
      const folders = new Set((kit.seed.folders ?? []).map((folder) => folder.key));
      for (const entry of kit.seed.entries) if (entry.folder) expect(folders.has(entry.folder), entry.key).toBe(true);
    });

    it('seeds content that publishes: complete, valid, every link resolved', () => {
      const ids = new Map(kit.seed.entries.map((entry, index) => [entry.key, `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`]));
      const blockFields = new Map(blockTypes.map((type) => [type.apiId, type.fields]));
      for (const entry of kit.seed.entries) {
        const type = contentTypes.find((candidate) => candidate.apiId === entry.contentType);
        expect(type, entry.key).toBeDefined();
        const fields = type?.fields ?? [];
        const data = toStoredData(fields, resolveRefs(entry.data, ids, new Set()).value as Record<string, unknown>, blockFields, 'en-GB');
        const result = buildEntrySchema(fields, { blockTypes }).safeParse(data);
        expect(result.success ? [] : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`), entry.key).toEqual([]);
        if (type?.fields.some((field) => field.apiId === 'slug')) expect(entry.data['slug'], entry.key).toBe(entry.slug);
      }
    });
  });
});
