import {
  createEntryRequestSchema,
  createFolderRequestSchema,
  entryTitle,
  listEntriesQuerySchema,
  moveEntryRequestSchema,
  slugify,
  slugSchema,
  updateEntryRequestSchema,
  updateFolderRequestSchema,
} from './entries';

describe('slugs', () => {
  it('accepts lowercase words joined by single hyphens', () => {
    expect(slugSchema.safeParse('about-us').success).toBe(true);
    expect(slugSchema.safeParse('2026').success).toBe(true);
    for (const bad of ['About', 'about--us', '-about', 'about-', 'about us', '', 'a'.repeat(101)]) {
      expect(slugSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('turns titles into slugs', () => {
    expect(slugify('Über uns & more!')).toBe('uber-uns-more');
    expect(slugify('  Hello,   World  ')).toBe('hello-world');
    expect(slugify('!!!')).toBe('');
    const long = slugify(`${'word '.repeat(30)}`);
    expect(long.length).toBeLessThanOrEqual(100);
    expect(slugSchema.safeParse(long).success).toBe(true);
  });
});

describe('entryTitle', () => {
  it('uses the title, then the name, then the slug', () => {
    expect(entryTitle({ title: ' Home ', name: 'Ignored' }, 'home')).toBe('Home');
    expect(entryTitle({ title: '', name: 'Jo Bloggs' }, 'jo')).toBe('Jo Bloggs');
    expect(entryTitle({ title: 42 }, 'fallback')).toBe('fallback');
  });
});

describe('request schemas', () => {
  it('creates an entry with empty data by default, and refuses unknown properties', () => {
    expect(createEntryRequestSchema.parse({ contentType: 'page' })).toEqual({ contentType: 'page', data: {} });
    expect(createEntryRequestSchema.safeParse({ contentType: 'page', status: 'published' }).success).toBe(false);
    expect(createEntryRequestSchema.safeParse({ contentType: 'Page' }).success).toBe(false);
  });

  it('needs data to save a version', () => {
    expect(updateEntryRequestSchema.safeParse({ message: 'Nothing' }).success).toBe(false);
    expect(updateEntryRequestSchema.parse({ data: { title: 'x' }, message: ' Tidy ' })).toEqual({
      data: { title: 'x' },
      message: 'Tidy',
    });
  });

  it('moves to a folder or to the top level', () => {
    expect(moveEntryRequestSchema.safeParse({ folderId: null }).success).toBe(true);
    expect(moveEntryRequestSchema.safeParse({}).success).toBe(false);
  });

  it('validates folders', () => {
    expect(createFolderRequestSchema.safeParse({ name: 'Blog', slug: 'blog' }).success).toBe(true);
    expect(createFolderRequestSchema.safeParse({ name: ' ', slug: 'blog' }).success).toBe(false);
    expect(updateFolderRequestSchema.safeParse({}).success).toBe(false);
    expect(updateFolderRequestSchema.safeParse({ parentId: null }).success).toBe(true);
  });

  it('reads list filters from the query string', () => {
    expect(listEntriesQuerySchema.parse({ deleted: 'true', folderId: 'root' })).toEqual({ deleted: true, folderId: 'root' });
    expect(listEntriesQuerySchema.parse({})).toEqual({ deleted: false });
    expect(listEntriesQuerySchema.safeParse({ deleted: 'yes' }).success).toBe(false);
  });
});
