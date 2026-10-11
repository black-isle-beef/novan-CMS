import type { Route } from '@angular/router';
import { requirePermission } from '@novan/admin-spaces';

/** The Forms inbox, inside the signed-in layout: for editors and admins, who the API and RLS also allow. */
export const formsRoutes: Route[] = [
  {
    path: 'spaces/:spaceId/forms',
    title: 'Forms | Novan CMS',
    canActivate: [requirePermission('forms.read')],
    loadComponent: () => import('./forms-page/forms-page').then((m) => m.FormsPage),
  },
];
