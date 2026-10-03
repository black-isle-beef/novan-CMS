import type { Route } from '@angular/router';
import { requireSession, requireSignedOut, sessionLoaded } from './auth.guards';

/** Signed-out and in-between screens; each renders its own page frame. */
export const authRoutes: Route[] = [
  {
    path: 'sign-in',
    title: 'Sign in | Novan CMS',
    canActivate: [requireSignedOut],
    loadComponent: () => import('./sign-in/sign-in-page').then((m) => m.SignInPage),
  },
  {
    path: 'forgot-password',
    title: 'Reset your password | Novan CMS',
    loadComponent: () => import('./forgot-password/forgot-password-page').then((m) => m.ForgotPasswordPage),
  },
  {
    path: 'update-password',
    title: 'Choose a new password | Novan CMS',
    canActivate: [sessionLoaded],
    loadComponent: () => import('./update-password/update-password-page').then((m) => m.UpdatePasswordPage),
  },
  {
    path: 'accept-invite',
    title: 'Welcome | Novan CMS',
    canActivate: [sessionLoaded],
    loadComponent: () => import('./accept-invite/accept-invite-page').then((m) => m.AcceptInvitePage),
  },
  {
    path: 'two-step',
    title: 'Two-step verification | Novan CMS',
    canActivate: [requireSession],
    loadComponent: () => import('./two-step/two-step-page').then((m) => m.TwoStepPage),
  },
];

/** The account page, shown inside the signed-in layout. */
export const accountRoute: Route = {
  path: 'account',
  title: 'Your account | Novan CMS',
  loadComponent: () => import('./account/account-page').then((m) => m.AccountPage),
};
