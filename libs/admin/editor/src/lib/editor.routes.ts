import type { Route } from '@angular/router';
import { unsavedChangesGuard } from '@novan/admin-shell';

/** The visual editor, inside the signed-in layout. Every member can open it; roles decide what they can change. */
export const editorRoutes: Route[] = [
  {
    path: 'spaces/:spaceId/pages/:entryId/edit',
    title: 'Edit on the page | Novan CMS',
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./visual-editor-page/visual-editor-page').then((m) => m.VisualEditorPage),
  },
];
