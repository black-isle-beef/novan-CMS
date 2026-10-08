import { TestBed } from '@angular/core/testing';
import { COALESCE_MS, EditorStore, HISTORY_LIMIT } from './editor-store';

describe('EditorStore', () => {
  let store: EditorStore;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [EditorStore] });
    store = TestBed.inject(EditorStore);
    store.load({ title: 'Home', body: [{ _uid: 'a', _block: 'hero', heading: 'Hi' }] });
  });

  const heading = (text: string) => ({ title: 'Home', body: [{ _uid: 'a', _block: 'hero', heading: text }] });

  it('tracks unsaved changes against what was saved', () => {
    expect(store.dirty()).toBe(false);
    store.change(heading('Hello'));
    expect(store.dirty()).toBe(true);
    store.markSaved(store.data());
    expect(store.dirty()).toBe(false);
    // Undoing past a save makes the page differ from it again.
    store.undo();
    expect(store.dirty()).toBe(true);
  });

  it('undoes and redoes changes, and a new change clears redo', () => {
    store.change(heading('One'), null, 0);
    store.change(heading('Two'), null, 10);
    expect(store.undo()).toBe(true);
    expect(store.data()).toEqual(heading('One'));
    expect(store.undo()).toBe(true);
    expect(store.data()).toEqual(heading('Hi'));
    expect(store.undo()).toBe(false);
    expect(store.redo()).toBe(true);
    expect(store.data()).toEqual(heading('One'));
    store.change(heading('Three'));
    expect(store.canRedo()).toBe(false);
  });

  it('joins quick changes to the same thing into one step', () => {
    store.change(heading('H'), 'a.heading', 0);
    store.change(heading('He'), 'a.heading', 300);
    store.change(heading('Hey'), 'a.heading', 600);
    store.change(heading('Hey!'), 'a.heading', 600 + COALESCE_MS);
    store.undo();
    expect(store.data()).toEqual(heading('Hey'));
    store.undo();
    expect(store.data()).toEqual(heading('Hi'));
  });

  it('ignores changes that change nothing', () => {
    store.change(heading('Hi'));
    expect(store.canUndo()).toBe(false);
  });

  it(`keeps the last ${HISTORY_LIMIT} steps`, () => {
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) store.change(heading(`v${i}`), null, i * 10);
    let undone = 0;
    while (store.undo()) undone++;
    expect(undone).toBe(HISTORY_LIMIT);
    expect(store.data()).toEqual(heading('v4'));
  });

  it('starts over when a page is loaded', () => {
    store.change(heading('Changed'));
    store.load(heading('Restored'));
    expect(store.canUndo()).toBe(false);
    expect(store.dirty()).toBe(false);
  });
});
