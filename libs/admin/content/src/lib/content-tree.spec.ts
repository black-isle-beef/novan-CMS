import type { EntrySummary, Folder } from '@novan/shared-schemas';
import { buildTree, searchEntries, statusBadges } from './content-tree';

const folder = (id: string, name: string, parentId: string | null = null): Folder => ({
  id,
  parentId,
  name,
  slug: name.toLowerCase(),
  path: `/${name.toLowerCase()}`,
  createdAt: '',
  updatedAt: '',
});

const entry = (id: string, title: string, folderId: string | null = null, extra: Partial<EntrySummary> = {}): EntrySummary => ({
  id,
  contentType: 'page',
  contentTypeName: 'Page',
  kind: 'page',
  folderId,
  slug: title.toLowerCase().replace(/ /g, '-'),
  path: `/${title.toLowerCase().replace(/ /g, '-')}`,
  missingTranslations: [],
  title,
  status: 'draft',
  hasUnpublishedChanges: false,
  createdAt: '',
  updatedAt: '',
  publishedAt: null,
  deletedAt: null,
  ...extra,
});

describe('content tree', () => {
  it('nests folders and their entries, sorted by name', () => {
    const tree = buildTree(
      [folder('b', 'Blog'), folder('n', 'News', 'b'), folder('a', 'Archive')],
      [entry('1', 'Home'), entry('2', 'Hello', 'n'), entry('3', 'About'), entry('4', 'Lost', 'gone')],
    );

    expect(tree.folders.map((f) => f.folder.name)).toEqual(['Archive', 'Blog']);
    expect(tree.folders[1].folders[0].entries.map((e) => e.title)).toEqual(['Hello']);
    expect(tree.entries.map((e) => e.title)).toEqual(['About', 'Home', 'Lost']);
  });

  it('searches titles, slugs and addresses', () => {
    const entries = [entry('1', 'Home'), entry('2', 'About us', null, { path: '/company/about-us' })];
    expect(searchEntries(entries, 'COMPANY about').map((e) => e.id)).toEqual(['2']);
    expect(searchEntries(entries, '').map((e) => e.id)).toEqual(['2', '1']);
  });

  it('describes status in words', () => {
    expect(statusBadges(entry('1', 'A')).map((b) => b.label)).toEqual(['Draft']);
    expect(statusBadges(entry('1', 'A', null, { status: 'published', hasUnpublishedChanges: true })).map((b) => b.label)).toEqual([
      'Published',
      'Changes not published',
    ]);
    expect(statusBadges(entry('1', 'A', null, { deletedAt: 'now' })).map((b) => b.label)).toEqual(['In the bin']);
  });
});
