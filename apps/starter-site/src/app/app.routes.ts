import { Route } from '@angular/router';

export const appRoutes: Route[] = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Novan starter site',
    loadComponent: () => import('./home/home-page').then((m) => m.HomePage),
  },
];
