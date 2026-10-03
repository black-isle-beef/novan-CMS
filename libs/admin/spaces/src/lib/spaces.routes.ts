import type { Route } from '@angular/router';
import { requireAgencyStaff } from '@novan/admin-auth';

/** Space screens, shown inside the signed-in layout. */
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
  // Space home: members is the only space screen so far.
  { path: 'spaces/:spaceId', pathMatch: 'full', redirectTo: 'spaces/:spaceId/members' },
  {
    path: 'spaces/:spaceId/members',
    title: 'People | Novan CMS',
    loadComponent: () => import('./members-page/members-page').then((m) => m.MembersPage),
  },
];
