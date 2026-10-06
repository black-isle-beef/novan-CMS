import { DestroyRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Shortcuts } from './shortcuts';

/** A DestroyRef the test destroys by hand. */
function scope() {
  const callbacks: (() => void)[] = [];
  const ref = { onDestroy: (callback: () => void) => callbacks.push(callback) } as unknown as DestroyRef;
  return { ref, destroy: () => callbacks.forEach((callback) => callback()) };
}

const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', { cancelable: true, ...init });

describe('Shortcuts', () => {
  let shortcuts: Shortcuts;
  beforeEach(() => (shortcuts = TestBed.inject(Shortcuts)));

  it('runs save on Ctrl+S or ⌘S, and publish on Ctrl+Shift+P or ⌘⇧P, instead of the browser', () => {
    const save = vi.fn();
    const publish = vi.fn();
    shortcuts.register('save', save, scope().ref);
    shortcuts.register('publish', publish, scope().ref);

    for (const event of [key({ key: 's', ctrlKey: true }), key({ key: 's', metaKey: true })]) {
      expect(shortcuts.handle(event)).toBe(true);
      expect(event.defaultPrevented).toBe(true);
    }
    expect(shortcuts.handle(key({ key: 'P', ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(shortcuts.handle(key({ key: 'p', metaKey: true, shiftKey: true }))).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it('leaves other keys, held-down repeats and unregistered shortcuts to the browser', () => {
    const save = vi.fn();
    shortcuts.register('save', save, scope().ref);

    for (const init of [{ key: 's' }, { key: 's', ctrlKey: true, altKey: true }, { key: 's', ctrlKey: true, repeat: true }, { key: 'p', ctrlKey: true }]) {
      const event = key(init);
      expect(shortcuts.handle(event)).toBe(false);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(shortcuts.handle(key({ key: 'p', ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it('goes to the screen that registered last, and back when it is destroyed', () => {
    const page = vi.fn();
    const dialog = vi.fn();
    shortcuts.register('save', page, scope().ref);
    const inner = scope();
    shortcuts.register('save', dialog, inner.ref);

    shortcuts.handle(key({ key: 's', ctrlKey: true }));
    inner.destroy();
    shortcuts.handle(key({ key: 's', ctrlKey: true }));
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(page).toHaveBeenCalledTimes(1);
  });
});
