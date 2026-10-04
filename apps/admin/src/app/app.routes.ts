import { Route } from '@angular/router';
import { accountRoute, authRoutes, requireSignedIn } from '@novan/admin-auth';
import { contentRoutes } from '@novan/admin-content';
import { schemaRoutes } from '@novan/admin-schema';
import { spacesRoutes } from '@novan/admin-spaces';

export const appRoutes: Route[] = [
  ...authRoutes,
  {
    path: '',
    canActivate: [requireSignedIn],
    loadComponent: () => import('./shell/shell').then((m) => m.Shell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'spaces' },
      ...spacesRoutes,
      ...contentRoutes,
      ...schemaRoutes,
      accountRoute,
      // Last, and lazy: the library is only loaded for its own URLs.
      { path: '', loadChildren: () => import('@novan/admin-media').then((m) => m.mediaRoutes) },
    ],
  },
  { path: '**', redirectTo: '' },
];
