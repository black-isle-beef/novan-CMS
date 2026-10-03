import { inject } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/** Signed in, and agency staff have completed their second factor. */
export const requireSignedIn: CanActivateFn = async (_, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.whenReady();

  if (!auth.signedIn()) return router.createUrlTree(['/sign-in'], { queryParams: { returnUrl: state.url } });
  if (auth.needsSecondFactor()) return router.createUrlTree(['/two-step'], { queryParams: { returnUrl: state.url } });
  return true;
};

/** Signed in at either assurance level (the two-step page itself). */
export const requireSession: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.whenReady();
  return auth.signedIn() || router.createUrlTree(['/sign-in']);
};

/** Only for signed-out visitors; others go to the admin home. */
export const requireSignedOut: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.whenReady();
  return !auth.signedIn() || router.createUrlTree(['/']);
};

/** Waits for a session carried in the URL (invite and reset links) before the page renders. */
export const sessionLoaded: CanActivateFn = async () => {
  await inject(AuthService).whenReady();
  return true;
};

/** Agency staff only (at AAL2, guaranteed by `requireSignedIn` on the parent route). */
export const requireAgencyStaff: CanActivateFn = () =>
  inject(AuthService).agencyStaff() || inject(Router).createUrlTree(['/']);

/** Only follow same-app relative return URLs, never an external one. */
export function safeReturnUrl(value: string | null | undefined): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}
