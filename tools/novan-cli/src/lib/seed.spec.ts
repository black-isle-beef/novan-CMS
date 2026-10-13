import { resolve } from 'node:path';
import { applyChanges } from './push';
import { diffSchemas } from './diff';
import { fakeApi, target } from './fake-api';
import { loadKit } from './kits';
import { resolveRefs, seed, toStoredData } from './seed';

const root = resolve(import.meta.dirname, '../../../..');

describe('toStoredData', () => {
  const blockTypes = new Map([['hero', [{ id: 'heading', apiId: 'heading', label: 'H', type: 'text', required: false, localised: true, multiline: false }]]] as const);

  it('wraps translated fields in a locale map, inside groups and blocks, and gives blocks a _uid', () => {
    const fields = [
      { id: 'title', apiId: 'title', label: 'T', type: 'text', required: true, localised: true, multiline: false },
      { id: 'slug', apiId: 'slug', label: 'S', type: 'text', required: true, localised: false, multiline: false },
      {
        id: 'seo', apiId: 'seo', label: 'SEO', type: 'group', required: false, localised: false, multiple: false,
        fields: [{ id: 'metaTitle', apiId: 'metaTitle', label: 'M', type: 'text', required: false, localised: true, multiline: false }],
      },
      { id: 'body', apiId: 'body', label: 'B', type: 'blocks', required: false, localised: false, allowedBlocks: ['hero'] },
    ] as never;

    const stored = toStoredData(fields, { title: 'Hi', slug: 'hi', seo: { metaTitle: 'Meta' }, body: [{ _block: 'hero', heading: 'Big' }] }, blockTypes as never, 'fr-FR');

    expect(stored).toMatchObject({ title: { 'fr-FR': 'Hi' }, slug: 'hi', seo: { metaTitle: { 'fr-FR': 'Meta' } } });
    expect((stored['body'] as Record<string, unknown>[])[0]).toEqual({ _uid: expect.stringMatching(/^[0-9a-f-]{36}$/), _block: 'hero', heading: { 'fr-FR': 'Big' } });
  });

  it('leaves a value already in a locale map alone', () => {
    const fields = [{ id: 'title', apiId: 'title', label: 'T', type: 'text', required: true, localised: true, multiline: false }] as never;

    expect(toStoredData(fields, { title: { 'en-GB': 'Hi', 'fr-FR': 'Salut' } }, new Map(), 'en-GB')).toEqual({ title: { 'en-GB': 'Hi', 'fr-FR': 'Salut' } });
  });
});

describe('resolveRefs', () => {
  const ids = new Map([['about', 'id-about']]);

  it('replaces each reference with the entry id', () => {
    expect(resolveRefs({ link: { type: 'internal', entryId: { $entry: 'about' } } }, ids, new Set())).toEqual({
      value: { link: { type: 'internal', entryId: 'id-about' } },
      partial: false,
    });
  });

  it('leaves out the object holding a reference to an entry not created yet', () => {
    const value = { items: [{ label: 'Contact', link: { type: 'internal', entryId: { $entry: 'contact' } } }] };

    expect(resolveRefs(value, ids, new Set(['contact']))).toEqual({ value: { items: [{ label: 'Contact', link: null }] }, partial: true });
  });

  it('refuses a reference to an entry the seed does not have', () => {
    expect(() => resolveRefs({ entryId: { $entry: 'nope' } }, ids, new Set())).toThrow('"nope", which is not one of its entries');
  });
});

describe('seed', () => {
  async function seeded(kitName: string) {
    const kit = loadKit(resolve(root, 'kits'), kitName);
    const { api, state } = fakeApi();
    const empty = { contentTypes: [], blockTypes: [] };
    await applyChanges(api, target, kit.schema, empty, diffSchemas(kit.schema, empty), { force: false, dryRun: false, log: () => undefined });
    state.calls = [];
    const result = await seed(api, target, kit.seed, { publish: true, message: 'Seeded', log: () => undefined });
    return { kit, state, result, api };
  }

  it('creates and publishes every page of the blog kit, posts in their folder', async () => {
    const { kit, state, result } = await seeded('blog');

    expect(result).toEqual({ created: kit.seed.entries.length, published: kit.seed.entries.length, skipped: 0 });
    expect(state.folders.map((folder) => folder.path)).toEqual(['/blog']);
    expect(state.entries.filter((entry) => entry.contentType === 'post').every((entry) => entry.path.startsWith('/blog/'))).toBe(true);
    expect(state.entries.every((entry) => entry.published)).toBe(true);
  });

  it('links pages to each other, whichever was created first', async () => {
    const { state } = await seeded('brochure');
    const id = (slug: string) => state.entries.find((entry) => entry.slug === slug)?.id;
    const home = state.entries.find((entry) => entry.slug === 'home');
    const hero = (home?.data['body'] as Record<string, unknown>[])[0];

    // Home is created before Services, so its link is filled in afterwards.
    expect(hero['action']).toEqual({ 'en-GB': { type: 'internal', entryId: id('services'), text: 'See our services' } });
    expect(state.calls).toContain('update entry /home');
  });

  it('keeps entries that already exist when seeded again', async () => {
    const { kit, state, api } = await seeded('brochure');
    const before = state.entries.length;

    const again = await seed(api, target, kit.seed, { publish: true, message: 'Seeded', log: () => undefined });
    expect(again).toEqual({ created: 0, published: 0, skipped: kit.seed.entries.length });
    expect(state.entries).toHaveLength(before);
  });

  it('asks for schema push first when the space lacks a content type', async () => {
    const kit = loadKit(resolve(root, 'kits'), 'blog');
    const { api } = fakeApi();

    await expect(seed(api, target, kit.seed, { publish: true, message: 'Seeded', log: () => undefined })).rejects.toThrow(/Run novan schema push first/);
  });
});
