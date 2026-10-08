import type { BlockNode, BlockType, EntryData, FieldDef } from '@novan/shared-schemas';
import {
  blocksAt,
  childList,
  copyBlock,
  dottedPath,
  insertBlock,
  locate,
  moveBlock,
  outline,
  removeBlock,
  replaceBlock,
  rootLists,
  textFields,
} from './block-tree';
import { applyPatches, diff } from './patches';

const type = (apiId: string, extra: Partial<BlockType> = {}): BlockType =>
  ({ apiId, name: apiId[0].toUpperCase() + apiId.slice(1), icon: null, previewImagePath: null, fields: [], allowedChildren: [], styleOptions: {}, ...extra }) as BlockType;

const types = [
  type('hero', {
    fields: [
      { id: 'h', apiId: 'heading', label: 'Heading', type: 'text', required: true, localised: false, multiline: false },
      { id: 's', apiId: 'sub', label: 'Sub', type: 'text', required: false, localised: false, multiline: true },
      { id: 'n', apiId: 'count', label: 'Count', type: 'number', required: false, localised: false },
    ] as FieldDef[],
  }),
  type('cta'),
  type('columns', { allowedChildren: ['cta', 'columns'] }),
];

const fields = [
  { id: 't', apiId: 'title', label: 'Title', type: 'text', required: true, localised: false, multiline: false },
  { id: 'b', apiId: 'body', label: 'Content', type: 'blocks', required: false, localised: false, allowedBlocks: [] },
  { id: 'a', apiId: 'aside', label: 'Aside', type: 'blocks', required: false, localised: false, allowedBlocks: ['cta'] },
] as FieldDef[];

const block = (uid: string, apiId: string, extra: Partial<BlockNode> = {}): BlockNode => ({ _uid: uid, _block: apiId, ...extra });

const page = (): EntryData => ({
  title: 'Home',
  body: [
    block('h1', 'hero', { heading: 'Hi' }),
    block('c1', 'columns', { children: [block('x1', 'cta'), block('x2', 'cta')] }),
    block('t1', 'cta'),
  ],
  aside: [block('a1', 'cta')],
});

const roots = rootLists(fields, types);
const uids = (data: EntryData, path: (string | number)[] = ['body']) =>
  blocksAt(data, { path, allowed: [], label: '' }).map((node) => node._uid);
const at = (data: EntryData, uid: string) => {
  const place = locate(data, roots, types, uid);
  if (!place) throw new Error(`no ${uid}`);
  return place;
};

describe('block tree', () => {
  it('finds the page’s block lists and what each allows', () => {
    expect(roots.map((list) => [list.path, list.allowed, list.label])).toEqual([
      [['body'], ['hero', 'cta', 'columns'], 'Content'],
      [['aside'], ['cta'], 'Aside'],
    ]);
    expect(childList(['body', 1], types[2])).toEqual({ path: ['body', 1, 'children'], allowed: ['cta', 'columns'], label: 'Inside Columns' });
    expect(childList(['body', 0], types[0])).toBeNull();
  });

  it('outlines every block, children included', () => {
    const [body, aside] = outline(page(), roots, types);
    expect(body.items.map((item) => [item.place.node._uid, item.depth, item.children?.items.map((c) => c.place.node._uid) ?? null])).toEqual([
      ['h1', 0, null],
      ['c1', 0, ['x1', 'x2']],
      ['t1', 0, null],
    ]);
    expect(aside.items[0].place.node._uid).toBe('a1');
  });

  it('locates a block and names its path as validation does', () => {
    const place = at(page(), 'x2');
    expect(place.parent?._uid).toBe('c1');
    expect(dottedPath(place)).toBe('body.1.children.1');
    expect(locate(page(), roots, types, 'nope')).toBeNull();
  });

  it('inserts, replaces and removes blocks without changing the original', () => {
    const data = page();
    const inserted = insertBlock(data, roots[0], 1, block('n1', 'cta'));
    expect(uids(inserted)).toEqual(['h1', 'n1', 'c1', 't1']);
    expect(uids(data)).toEqual(['h1', 'c1', 't1']);

    const replaced = replaceBlock(data, at(data, 'h1'), block('h1', 'hero', { heading: 'Changed' }));
    expect((replaced['body'] as BlockNode[])[0]['heading']).toBe('Changed');

    const removed = removeBlock(removeBlock(data, at(data, 'x1')), at(removeBlock(data, at(data, 'x1')), 'x2'));
    // An emptied children list goes.
    expect((removed['body'] as BlockNode[])[1]).toEqual({ _uid: 'c1', _block: 'columns' });
    // Into a block with no children yet.
    const into = insertBlock(removed, childList(['body', 1], types[2]) as never, 0, block('n2', 'cta'));
    expect(uids(into, ['body', 1, 'children'])).toEqual(['n2']);
  });

  it('moves blocks within a list, both ways', () => {
    const data = page();
    expect(uids(moveBlock(data, at(data, 'h1'), roots[0], 3) as EntryData)).toEqual(['c1', 't1', 'h1']);
    expect(uids(moveBlock(data, at(data, 't1'), roots[0], 0) as EntryData)).toEqual(['t1', 'h1', 'c1']);
    expect(moveBlock(data, at(data, 'h1'), roots[0], 1)).toBe(data);
  });

  it('moves blocks into and out of containers that allow them', () => {
    const data = page();
    const inner = at(data, 'x1').list;
    const inside = moveBlock(data, at(data, 't1'), inner, 2) as EntryData;
    expect(uids(inside)).toEqual(['h1', 'c1']);
    expect(uids(inside, ['body', 1, 'children'])).toEqual(['x1', 'x2', 't1']);

    // Out, to before its own container: the container's place shifts as the block arrives.
    const out = moveBlock(data, at(data, 'x2'), roots[0], 1) as EntryData;
    expect(uids(out)).toEqual(['h1', 'x2', 'c1', 't1']);
    expect(uids(out, ['body', 2, 'children'])).toEqual(['x1']);

    // To another field.
    expect(uids(moveBlock(data, at(data, 'x1'), roots[1], 0) as EntryData, ['aside'])).toEqual(['x1', 'a1']);
  });

  it('refuses moves a list does not allow, and moves into the block itself', () => {
    const data = page();
    expect(moveBlock(data, at(data, 'h1'), at(data, 'x1').list, 0)).toBeNull();
    expect(moveBlock(data, at(data, 'h1'), roots[1], 0)).toBeNull();
    expect(moveBlock(data, at(data, 'c1'), at(data, 'x1').list, 0)).toBeNull();
  });

  it('copies a block and its children with new uids', () => {
    let n = 0;
    const copy = copyBlock(at(page(), 'c1').node, () => `new-${++n}`);
    expect(copy._uid).toBe('new-1');
    expect(copy.children?.map((c) => c._uid)).toEqual(['new-2', 'new-3']);
  });

  it('lists the plain text fields that can be edited on the page', () => {
    expect(textFields(block('h1', 'hero', { heading: 'Hi', count: 2 }), types[0])).toEqual([{ field: 'heading', value: 'Hi', multiline: false }]);
    expect(textFields(block('c', 'cta'), types[1])).toEqual([]);
  });
});

describe('patches', () => {
  it('are the smallest changes, and undo with the reverse diff', () => {
    const before = page();
    const after = replaceBlock(before, at(before, 'x1'), block('x1', 'cta', { heading: 'New' }));
    const forward = diff(before, after);
    expect(forward).toEqual([{ path: ['body', 1, 'children', 0, 'heading'], value: 'New' }]);
    expect(applyPatches(before, forward)).toEqual(after);
    expect(applyPatches(after, diff(after, before))).toEqual(before);
  });

  it('replace lists that change length and remove keys', () => {
    const before = page();
    const after = { ...removeBlock(before, at(before, 'h1')) };
    delete after['aside'];
    const forward = diff(before, after);
    expect(forward).toEqual([
      { path: ['body'], value: after['body'] },
      { path: ['aside'], value: undefined },
    ]);
    expect(applyPatches(before, forward)).toEqual(after);
    expect(applyPatches(after, diff(after, before))).toEqual(before);
  });
});
