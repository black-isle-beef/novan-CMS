import { DOCUMENT, inject, InjectionToken, makeStateKey, TransferState } from '@angular/core';

/** The published Contact page's `form` block, which enquiries are sent to (docs/clients/marketing-site.md). */
export interface ContactFormTarget {
  entryId: string;
  formUid: string;
}

/**
 * Settings that differ between environments. The server reads them from its environment (web.server.ts) and passes
 * them to the browser with the page, so one image serves staging and production.
 */
export interface SiteConfig {
  /** The site's public origin, e.g. `https://novan.example`, for canonical links and social cards. */
  siteUrl: string;
  /** The CMS admin's sign-in page. */
  cmsLoginUrl: string;
  /** Where enquiries go; `null` hides the form and offers email instead. */
  contactForm: ContactFormTarget | null;
}

export const SITE_CONFIG_STATE = makeStateKey<SiteConfig>('web:siteConfig');

/** The admin's local address, for development and tests. */
export const LOCAL_CMS_LOGIN_URL = 'http://localhost:4200/sign-in';

export const SITE_CONFIG = new InjectionToken<SiteConfig>('SITE_CONFIG', {
  providedIn: 'root',
  factory: () =>
    inject(TransferState).get(SITE_CONFIG_STATE, {
      siteUrl: inject(DOCUMENT).location?.origin ?? '',
      cmsLoginUrl: LOCAL_CMS_LOGIN_URL,
      contactForm: null,
    }),
});
