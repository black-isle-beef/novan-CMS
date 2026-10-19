import { SchemaSyncError } from './errors';
import { fromFiles } from './schema-files';

const text = (apiId: string) => ({ id: apiId, apiId, label: apiId, type: 'text' });
const page = { apiId: 'page', name: 'Page', kind: 'page', fields: [text('title')] };
const hero = { apiId: 'hero', name: 'Hero', fields: [text('heading')] };

describe('fromFiles', () => {
  it('reads content types and block types by folder, sorted, with defaults filled in', () => {
    const set = fromFiles(
      [
        { path: 'novan/schema/block-types/hero.json', json: hero },
        { path: 'novan/schema/content-types/post.json', json: { ...page, apiId: 'post', name: 'Post' } },
        { path: 'novan/schema/content-types/page.json', json: page },
        { path: 'novan/schema/README.md', json: null },
        { path: 'novan/schema/other/x.json', json: {} },
      ],
      'novan/schema',
    );

    expect(set.contentTypes.map((t) => t.apiId)).toEqual(['page', 'post']);
    expect(set.contentTypes[0].description).toBeNull();
    expect(set.blockTypes).toEqual([expect.objectContaining({ apiId: 'hero', icon: null, allowedChildren: [], styleOptions: {} })]);
  });

  it('accepts Windows paths', () => {
    const set = fromFiles([{ path: 'C:\\site\\novan\\schema\\block-types\\hero.json', json: hero }], 'C:\\site\\novan\\schema');
    expect(set.blockTypes.map((t) => t.apiId)).toEqual(['hero']);
  });

  it('refuses a file not named after its type', () => {
    expect(() => fromFiles([{ path: 'schema/content-types/home.json', json: page }], 'schema')).toThrow(
      'schema/content-types/home.json defines "page": name the file page.json.',
    );
  });

  it('refuses an invalid definition, naming the file and the problem', () => {
    const run = () => fromFiles([{ path: 'schema/content-types/page.json', json: { ...page, kind: 'nope' } }], 'schema');
    expect(run).toThrow(SchemaSyncError);
    expect(run).toThrow(/schema\/content-types\/page\.json is not a valid definition:\n {2}kind:/);
  });

  it('refuses a directory with no types', () => {
    expect(() => fromFiles([], 'schema')).toThrow('schema has no content types or block types.');
  });
});
