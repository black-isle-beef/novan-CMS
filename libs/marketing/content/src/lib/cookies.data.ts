/**
 * The single list of cookies and browser storage this site uses. The cookie policy's table and the consent
 * manager both read it, so they cannot drift apart. Add an entry here before adding anything that stores data
 * in a visitor's browser.
 *
 * TODO(confirm): check the live Cloudflare zone for cookies it sets itself (e.g. `__cf_bm` when Bot Fight Mode is
 * on) and list them here as strictly necessary.
 */

export type ConsentCategoryId = 'necessary' | 'analytics' | 'marketing';

export interface ConsentCategory {
  id: ConsentCategoryId;
  name: string;
  description: string;
  /** Strictly necessary storage is always on and cannot be refused (PECR's exemption). */
  required: boolean;
}

export interface StorageItem {
  name: string;
  purpose: string;
  provider: string;
  duration: string;
  category: ConsentCategoryId;
  kind: 'Cookie' | 'Local storage';
}

/** Name of the first-party cookie holding the visitor's choices. */
export const CONSENT_COOKIE = 'novan_consent';

/** How long a choice is remembered before we ask again. */
export const CONSENT_MAX_AGE_DAYS = 180;

/** Bump when categories change, so everyone is asked again. */
export const CONSENT_VERSION = 1;

export const consentCategories: readonly ConsentCategory[] = [
  {
    id: 'necessary',
    name: 'Strictly necessary',
    description: 'Needed for the site to work and to remember your cookie choices. These are always on.',
    required: true,
  },
  {
    id: 'analytics',
    name: 'Analytics',
    // TODO(confirm): no analytics provider is used yet. Name it here when one is chosen.
    description: 'Would help us understand how the site is used, so we can improve it. We do not use analytics yet.',
    required: false,
  },
  {
    id: 'marketing',
    name: 'Marketing',
    description: 'Would let us measure our advertising and show relevant adverts elsewhere. We do not use marketing cookies yet.',
    required: false,
  },
];

export const storageRegister: readonly StorageItem[] = [
  {
    name: CONSENT_COOKIE,
    purpose: 'Remembers your cookie choices, so we do not ask on every page.',
    provider: 'This website',
    duration: '6 months',
    category: 'necessary',
    kind: 'Cookie',
  },
];
