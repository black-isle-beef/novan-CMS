import { Route } from '@angular/router';
import { LandingPage } from './landing/landing-page';

export const appRoutes: Route[] = [
  { path: '', component: LandingPage, title: 'Novan CMS' },
  { path: '**', redirectTo: '' },
];
