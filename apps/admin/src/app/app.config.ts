import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { ADMIN_CONFIG, authInterceptor, viewAsReadOnlyInterceptor } from '@novan/admin-auth';
import { environment } from '../environments/environment';
import { adminConfig, runtimeConfig } from '../environments/runtime-config';
import { appRoutes } from './app.routes';
import { provideErrorReporting } from './error-reporting';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes, withComponentInputBinding()),
    // Writes are refused while agency staff view a space as another role, before the token is attached.
    provideHttpClient(withInterceptors([viewAsReadOnlyInterceptor, authInterceptor])),
    // A deployed admin's config.js overrides the build's settings (package 20).
    { provide: ADMIN_CONFIG, useValue: adminConfig(environment) },
    ...provideErrorReporting(runtimeConfig()),
  ],
};
