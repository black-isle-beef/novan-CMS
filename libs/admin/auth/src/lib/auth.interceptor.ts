import { HttpErrorResponse, type HttpInterceptorFn, type HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { ADMIN_CONFIG } from './admin-config';
import { AuthService } from './auth.service';

/**
 * Adds the Supabase access token to Novan API calls. On a 401 it refreshes the session once and
 * retries; if that fails the user is signed out and sent to the sign-in page.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const apiUrl = inject(ADMIN_CONFIG).apiUrl;
  if (!req.url.startsWith(apiUrl)) return next(req);

  const auth = inject(AuthService);
  const router = inject(Router);
  const withToken = (request: HttpRequest<unknown>, token: string | null): HttpRequest<unknown> =>
    token ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : request;

  return next(withToken(req, auth.accessToken())).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401) return throwError(() => error);

      return from(auth.refresh()).pipe(
        switchMap((session) => {
          if (!session) {
            void auth.signOut().then(() => router.navigate(['/sign-in']));
            return throwError(() => error);
          }
          return next(withToken(req, session.access_token));
        }),
      );
    }),
  );
};
