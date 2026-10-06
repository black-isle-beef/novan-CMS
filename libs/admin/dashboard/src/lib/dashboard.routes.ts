import type { Route } from '@angular/router';

/** A space's dashboard, its home inside the signed-in layout. Every member can open it. */
export const dashboardRoutes: Route[] = [
  {
    path: 'spaces/:spaceId',
    pathMatch: 'full',
    title: 'Dashboard | Novan CMS',
    loadComponent: () => import('./dashboard-page/dashboard-page').then((m) => m.DashboardPage),
  },
];
