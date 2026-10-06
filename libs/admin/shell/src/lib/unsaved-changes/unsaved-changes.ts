import { DestroyRef, DOCUMENT, inject } from '@angular/core';
import type { CanDeactivateFn } from '@angular/router';
import { Confirm } from '../confirm/confirm';

/** A screen with a form that can hold unsaved changes. */
export interface HasUnsavedChanges {
  hasUnsavedChanges(): boolean;
}

/**
 * Asks before leaving a screen with unsaved changes for another screen of the admin. Pair it with
 * {@link warnBeforeUnload} for closing the tab or leaving the site.
 */
export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = (component) =>
  !component.hasUnsavedChanges() ||
  inject(Confirm).ask({
    heading: 'Leave without saving?',
    body: 'Your latest changes are not saved yet. If you leave now, they are lost.',
    confirmLabel: 'Leave without saving',
    cancelLabel: 'Stay on this page',
    destructive: true,
  });

/** Has the browser ask before the tab closes or reloads while `hasUnsavedChanges()` is true. Call in a constructor. */
export function warnBeforeUnload(hasUnsavedChanges: () => boolean): void {
  const window = inject(DOCUMENT).defaultView;
  if (!window) return;
  const listener = (event: BeforeUnloadEvent): void => {
    if (hasUnsavedChanges()) event.preventDefault();
  };
  window.addEventListener('beforeunload', listener);
  inject(DestroyRef).onDestroy(() => window.removeEventListener('beforeunload', listener));
}
