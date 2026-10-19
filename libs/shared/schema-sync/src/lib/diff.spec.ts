import { canonical, diffSchemas, formatChanges } from './diff';
import { type SchemaSet, toBlockTypeFile, toContentTypeFile } from './schema-files';

const text = (apiId: string, extra: object = {}) => ({ id: apiId, apiId, label: apiId, type: 'text', ...extra });
const page = (fields: object[], extra: object = {}) => toContentTypeFile({ apiId: 'page', name: 'Page', kind: 'page', fields, ...extra });
const hero = (extra: object = {}) =>
  toBlockTypeFile({
    apiId: 'hero',
    name: 'Hero',
    icon: 'image',
    fields: [text('heading')],
    styleOptions: { tone: { kind: 'radio', label: 'Tone', options: [{ value: 'light', label: 'Light' }], default: 'light' } },
    ...extra,
  });
const set = (contentTypes = [page([text('title')])], blockTypes = [hero()]): SchemaSet => ({ contentTypes, blockTypes });

describe('diffSchemas', () => {
  it('finds nothing when only key order differs', () => {
    const reordered = JSON.parse(JSON.stringify(set()).replace('"apiId":"page","name":"Page"', '"name":"Page","apiId":"page"'));

    expect(canonical(reordered)).toBe(canonical(set()));
    expect(diffSchemas(set(), reordered)).toEqual([]);
  });

  it('creates types the space lacks', () => {
    expect(diffSchemas(set(), { contentTypes: [], blockTypes: [] })).toEqual([
      { action: 'create', kind: 'contentType', apiId: 'page', details: [], destructive: false },
      { action: 'create', kind: 'blockType', apiId: 'hero', details: [], destructive: false },
    ]);
  });

  it('treats deleting a type as destructive', () => {
    const [change] = diffSchemas(set([], [hero()]), set());

    expect(change).toEqual({ action: 'delete', kind: 'contentType', apiId: 'page', details: [], destructive: true });
  });

  it('describes field changes, and treats removing a field or changing its type as destructive', () => {
    const remote = set([page([text('title', { max: 120 }), text('old'), text('count')])]);
    const local = set([page([text('title', { max: 80 }), { id: 'count', apiId: 'count', label: 'count', type: 'number' }, text('summary', { required: true })])]);

    const [change] = diffSchemas(local, remote);
    expect(change.destructive).toBe(true);
    expect(change.details).toEqual(['fields.title changed', 'fields.count: type text → number', 'fields.summary added (required)', 'fields.old removed']);
  });

  it('looks inside groups', () => {
    const group = (fields: object[]) => ({ id: 'seo', apiId: 'seo', label: 'SEO', type: 'group', fields });
    const [change] = diffSchemas(set([page([group([text('a')])])]), set([page([group([text('a'), text('b')])])]));

    expect(change.details).toEqual(['fields.seo.b removed']);
    expect(change.destructive).toBe(true);
  });

  it('keeps style option and naming changes safe', () => {
    const local = set(undefined, [hero({ name: 'Banner', icon: 'star', styleOptions: {} })]);
    const [change] = diffSchemas(local, set());

    expect(change).toMatchObject({ action: 'update', kind: 'blockType', destructive: false });
    expect(change.details).toEqual(['name: "Hero" → "Banner"', 'icon: image → star', 'style option tone removed']);
  });

  it('notices a reordered field list', () => {
    const [change] = diffSchemas(set([page([text('b'), text('a')])]), set([page([text('a'), text('b')])]));

    expect(change.details).toEqual(['fields reordered']);
  });

  it('formats changes for the terminal', () => {
    const changes = diffSchemas(set([page([text('title'), text('extra')])], []), set());

    expect(formatChanges(changes)).toEqual(['~ content type page', '    fields.extra added', '- block type hero  (destructive)']);
  });
});
