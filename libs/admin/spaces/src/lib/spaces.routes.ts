import type { Route } from '@angular/router';
import { requireAgencyStaff } from '@novan/admin-auth';

/** Space screens, shown inside the signed-in layout. A space's home, its dashboard, is in @novan/admin-dashboard. */
export const spacesRoutes: Route[] = [
  {
    path: 'spaces',
    title: 'Spaces | Novan CMS',
    loadComponent: () => import('./spaces-page/spaces-page').then((m) => m.SpacesPage),
  },
  {
    path: 'spaces/new',
    title: 'Create a space | Novan CMS',
    canActivate: [requireAgencyStaff],
    loadComponent: () => import('./create-space-page/create-space-page').then((m) => m.CreateSpacePage),
  },
  {
    path: 'spaces/:spaceId/members',
    title: 'Team | Novan CMS',
    loadComponent: () => import('./members-page/members-page').then((m) => m.MembersPage),
  },
];
