import type { CdkDrag, CdkDragDrop, CdkDropList } from '@angular/cdk/drag-drop';
import { TestBed } from '@angular/core/testing';
import type { BlockType } from '@novan/shared-schemas';
import { type BlockList, type BlockPlace, outline } from '../block-tree';
import { BlockOutline, type BlockMove } from './block-outline';
import { BlockPicker } from '../block-picker/block-picker';

const body: BlockList = { path: ['body'], allowed: ['hero', 'columns'], label: 'Content' };
const types = [
  { apiId: 'hero', name: 'Hero', icon: 'image', allowedChildren: [] },
  { apiId: 'columns', name: 'Columns', icon: null, allowedChildren: ['hero'] },
] as unknown as BlockType[];
const data = {
  body: [
    { _uid: 'a', _block: 'hero' },
    { _uid: 'b', _block: 'columns', children: [{ _uid: 'c', _block: 'hero', _hidden: true }] },
  ],
};

function render(readonly = false) {
  const fixture = TestBed.createComponent(BlockOutline);
  fixture.componentRef.setInput('lists', outline(data, [body], types));
  fixture.componentRef.setInput('blockTypes', types);
  fixture.componentRef.setInput('readonly', readonly);
  fixture.detectChanges();
  const moves: BlockMove[] = [];
  fixture.componentInstance.move.subscribe((move) => moves.push(move));
  // The protected members the template uses.
  const outlineApi = fixture.componentInstance as unknown as {
    dropped(event: Partial<CdkDragDrop<BlockList, BlockList, BlockPlace>>): void;
    accepts(drag: Partial<CdkDrag<BlockPlace>>, drop: Partial<CdkDropList<BlockList>>): boolean;
  };
  return { fixture, el: fixture.nativeElement as HTMLElement, moves, outlineApi };
}

describe('BlockOutline', () => {
  it('lists blocks as a tree, marking hidden ones', () => {
    const { el } = render();
    const names = [...el.querySelectorAll('.nv-outline-select')].map((b) => b.textContent?.replace(/\s+/g, ' ').trim());
    expect(names).toEqual(['Hero , block 1 of 2', 'Columns , block 2 of 2', 'Hero , block 1 of 1']);
    expect(el.querySelector('.nv-outline-children')?.textContent).toContain('Hidden');
  });

  it('turns a drop into a move counted before the move', () => {
    const { moves, outlineApi } = render();
    const [a] = outline(data, [body], types)[0].items;
    const list = { data: body } as CdkDropList<BlockList>;
    outlineApi.dropped({ item: { data: a.place } as never, previousContainer: list, container: list, previousIndex: 0, currentIndex: 1 });
    outlineApi.dropped({ item: { data: a.place } as never, previousContainer: list, container: list, previousIndex: 0, currentIndex: 0 });
    expect(moves).toEqual([{ from: a.place, to: body, index: 2 }]);
  });

  it('only lets blocks into lists that take them, never into themselves', () => {
    const { outlineApi } = render();
    const [a, b] = outline(data, [body], types)[0].items;
    const inner = b.children?.list as BlockList;
    expect(outlineApi.accepts({ data: a.place }, { data: inner })).toBe(true);
    expect(outlineApi.accepts({ data: b.place }, { data: inner })).toBe(false);
    expect(outlineApi.accepts({ data: b.place }, { data: body })).toBe(true);
  });

  it('offers no changes when read-only', () => {
    const { el } = render(true);
    expect(el.querySelector('[id^="nv-outline-up-"]')).toBeNull();
    expect(el.textContent).not.toContain('Add block');
  });
});

describe('BlockPicker', () => {
  it('shows preview images from the site or https addresses only', () => {
    const fixture = TestBed.createComponent(BlockPicker);
    const withImage = (previewImagePath: string) => ({ ...types[0], apiId: previewImagePath, previewImagePath });
    fixture.componentRef.setInput('siteUrl', 'https://site.test');
    fixture.componentRef.setInput('request', {
      where: 'to Content',
      types: [withImage('/blocks/hero.png'), withImage('https://cdn.test/a.png'), withImage('http://plain.test/a.png'), withImage('//evil.test/a.png')],
    });
    const images = (fixture.componentInstance as unknown as { choices(): { image: string | null }[] }).choices().map((c) => c.image);
    expect(images).toEqual(['https://site.test/blocks/hero.png', 'https://cdn.test/a.png', null, null]);
  });
});
