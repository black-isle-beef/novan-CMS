import { Route } from '@angular/router';
import { accountRoute, authRoutes, requireSignedIn } from '@novan/admin-auth';
import { spacesRoutes } from '@novan/admin-spaces';

export const appRoutes: Route[] = [
  ...authRoutes,
  {
    path: '',
    canActivate: [requireSignedIn],
    loadComponent: () => import('./shell/shell').then((m) => m.Shell),
    children: [{ path: '', pathMatch: 'full', redirectTo: 'spaces' }, ...spacesRoutes, accountRoute],
  },
  { path: '**', redirectTo: '' },
];
