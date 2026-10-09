import { DOCUMENT, inject, InjectionToken, makeStateKey, TransferState } from '@angular/core';

/** Carries the server's site address to the browser, so canonical links do not change on hydration. */
export const SITE_URL_STATE = makeStateKey<string>('novan:siteUrl');

/**
 * The site's public address, e.g. `https://www.example.com`, for canonical links, Open Graph URLs and structured
 * data. The server provides `SITE_URL` (app.config.server.ts); the browser takes what the server used, or its own
 * origin.
 */
export const SITE_URL = new InjectionToken<string>('SITE_URL', {
  providedIn: 'root',
  factory: () => inject(TransferState).get(SITE_URL_STATE, inject(DOCUMENT).location?.origin ?? ''),
});
