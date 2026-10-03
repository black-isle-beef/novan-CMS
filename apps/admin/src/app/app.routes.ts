import { Route } from '@angular/router';

export const appRoutes: Route[] = [
  { path: '', pathMatch: 'full', redirectTo: 'sign-in' },
  {
    path: 'sign-in',
    title: 'Sign in | Novan CMS',
    loadComponent: () => import('./sign-in/sign-in-page').then((m) => m.SignInPage),
  },
];
