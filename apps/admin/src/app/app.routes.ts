import { Route } from '@angular/router';
import { accountRoute, authRoutes, requireSignedIn } from '@novan/admin-auth';

export const appRoutes: Route[] = [
  ...authRoutes,
  {
    path: '',
    canActivate: [requireSignedIn],
    loadComponent: () => import('@novan/admin-shell').then((m) => m.AdminShell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'spaces' },
      accountRoute,
      // Every feature library loads on first use. Order matters: spaces/new comes before a space's dashboard
      // (spaces/:spaceId).
      { path: '', loadChildren: () => import('@novan/admin-spaces').then((m) => m.spacesRoutes) },
      { path: '', loadChildren: () => import('@novan/admin-dashboard').then((m) => m.dashboardRoutes) },
      { path: '', loadChildren: () => import('@novan/admin-content').then((m) => m.contentRoutes) },
      { path: '', loadChildren: () => import('@novan/admin-media').then((m) => m.mediaRoutes) },
      { path: '', loadChildren: () => import('@novan/admin-schema').then((m) => m.schemaRoutes) },
      { path: '', loadChildren: () => import('@novan/admin-settings').then((m) => m.settingsRoutes) },
      { path: '', loadChildren: () => import('@novan/admin-shell').then((m) => m.placeholderRoutes) },
    ],
  },
  { path: '**', redirectTo: '' },
];