import { diffEntryData, sameJson } from './entry-diff';

const uid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hero = (n: number, heading: string) => ({ _uid: uid(n), _block: 'hero', heading });

describe('diffEntryData', () => {
  it('finds no changes in equal data, whatever the key order', () => {
    expect(diffEntryData({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toEqual([]);
  });

  it('reports added, removed and changed fields, including inside groups', () => {
    expect(
      diffEntryData(
        { title: 'Home', subtitle: 'Old', seo: { metaTitle: 'A', noindex: false } },
        { title: 'Home page', seo: { metaTitle: 'B', noindex: false }, tags: ['x'] },
      ),
    ).toEqual([
      { kind: 'changed', path: ['title'], before: 'Home', after: 'Home page' },
      { kind: 'removed', path: ['subtitle'], before: 'Old' },
      { kind: 'changed', path: ['seo', 'metaTitle'], before: 'A', after: 'B' },
      { kind: 'added', path: ['tags'], after: ['x'] },
    ]);
  });

  it('matches blocks by _uid: added, removed, and changes inside a block', () => {
    const before = { body: [hero(1, 'One'), hero(2, 'Two')] };
    const after = { body: [hero(1, 'One!'), hero(3, 'Three')] };

    expect(diffEntryData(before, after)).toEqual([
      { kind: 'removed', path: ['body', uid(2)], block: 'hero', before: hero(2, 'Two') },
      { kind: 'added', path: ['body', uid(3)], block: 'hero', after: hero(3, 'Three') },
      { kind: 'changed', path: ['body', uid(1), 'heading'], block: 'hero', before: 'One', after: 'One!' },
    ]);
  });

  it('reports a reordered block as moved, not removed and added', () => {
    const before = { body: [hero(1, 'One'), hero(2, 'Two'), hero(3, 'Three')] };
    const after = { body: [hero(3, 'Three'), hero(1, 'One'), hero(2, 'Two')] };

    expect(diffEntryData(before, after)).toEqual([
      { kind: 'moved', path: ['body', uid(3)], block: 'hero', from: 2, to: 0 },
      { kind: 'moved', path: ['body', uid(1)], block: 'hero', from: 0, to: 1 },
      { kind: 'moved', path: ['body', uid(2)], block: 'hero', from: 1, to: 2 },
    ]);
  });

  it('does not count blocks shifted by an insertion as moved', () => {
    const before = { body: [hero(1, 'One'), hero(2, 'Two')] };
    const after = { body: [hero(3, 'New'), hero(1, 'One'), hero(2, 'Two')] };
    expect(diffEntryData(before, after).map((change) => change.kind)).toEqual(['added']);
  });

  it('treats a missing or empty blocks field as an empty list', () => {
    expect(diffEntryData({}, { body: [hero(1, 'One')] })).toEqual([
      { kind: 'added', path: ['body', uid(1)], block: 'hero', after: hero(1, 'One') },
    ]);
    expect(diffEntryData({ body: [hero(1, 'One')] }, { body: [] })).toEqual([
      { kind: 'removed', path: ['body', uid(1)], block: 'hero', before: hero(1, 'One') },
    ]);
  });

  it('follows nested children by _uid', () => {
    const columns = (children: unknown[]) => ({ _uid: uid(9), _block: 'columns', children });
    expect(diffEntryData({ body: [columns([hero(1, 'A')])] }, { body: [columns([hero(1, 'B')])] })).toEqual([
      { kind: 'changed', path: ['body', uid(9), 'children', uid(1), 'heading'], block: 'hero', before: 'A', after: 'B' },
    ]);
  });

  it('reports a block whose type changed as one change', () => {
    const before = { body: [hero(1, 'One')] };
    const after = { body: [{ _uid: uid(1), _block: 'cta', heading: 'One' }] };
    expect(diffEntryData(before, after)).toEqual([
      { kind: 'changed', path: ['body', uid(1)], block: 'cta', before: before.body[0], after: after.body[0] },
    ]);
  });
});

describe('sameJson', () => {
  it('ignores key order and undefined properties', () => {
    expect(sameJson({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(sameJson([1, { x: 2 }], [1, { x: 2 }])).toBe(true);
    expect(sameJson([1, 2], [2, 1])).toBe(false);
    expect(sameJson({ a: null }, {})).toBe(false);
  });
});
