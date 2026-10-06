import { DestroyRef, inject, Injectable } from '@angular/core';

/** Keyboard shortcuts the admin offers: Ctrl+S (⌘S on a Mac) saves, Ctrl+Shift+P (⌘⇧P) publishes. */
export type ShortcutAction = 'save' | 'publish';

/** For `aria-keyshortcuts` on the buttons the shortcuts press. */
export const shortcutKeys: Record<ShortcutAction, string> = {
  save: 'Control+S Meta+S',
  publish: 'Control+Shift+P Meta+Shift+P',
};

/**
 * Routes the shortcuts to whichever screen registered them last (the shell listens for the keys). A shortcut
 * with no handler does nothing, so the browser keeps its own behaviour there.
 */
@Injectable({ providedIn: 'root' })
export class Shortcuts {
  private readonly handlers = new Map<ShortcutAction, (() => void)[]>();

  /** Registers `handler` until `destroyRef` (by default, the caller's) is destroyed. */
  register(action: ShortcutAction, handler: () => void, destroyRef = inject(DestroyRef)): void {
    this.handlers.set(action, [...(this.handlers.get(action) ?? []), handler]);
    destroyRef.onDestroy(() => this.handlers.set(action, (this.handlers.get(action) ?? []).filter((h) => h !== handler)));
  }

  /** Handles a keydown; returns whether it ran a shortcut. */
  handle(event: KeyboardEvent): boolean {
    const action = shortcutFor(event);
    const handlers = action ? (this.handlers.get(action) ?? []) : [];
    const handler = handlers[handlers.length - 1];
    if (!handler) return false;
    event.preventDefault();
    handler();
    return true;
  }
}

function shortcutFor(event: KeyboardEvent): ShortcutAction | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.repeat) return null;
  const key = event.key.toLowerCase();
  if (key === 's' && !event.shiftKey) return 'save';
  if (key === 'p' && event.shiftKey) return 'publish';
  return null;
}
