import type { Route } from '@angular/router';
import { unsavedChangesGuard } from '@novan/admin-shell';

/** Content screens, inside the signed-in layout. Every member can open them; roles decide what they can change. */
export const contentRoutes: Route[] = [
  {
    path: 'spaces/:spaceId/content',
    title: 'Pages | Novan CMS',
    loadComponent: () => import('./content-page/content-page').then((m) => m.ContentPage),
  },
  {
    path: 'spaces/:spaceId/content/:entryId',
    title: 'Edit | Novan CMS',
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./entry-editor-page/entry-editor-page').then((m) => m.EntryEditorPage),
  },
];