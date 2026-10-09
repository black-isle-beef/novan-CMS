import { DOCUMENT, inject, Injector } from '@angular/core';
import type { NovanSiteSettings, Page } from './types';

/** A JSON-LD object, e.g. from {@link novanOrganizationJsonLd}. */
export type NovanJsonLd = Record<string, unknown>;

/** One step of a breadcrumb trail: what to call it, and its path on the site. */
export interface NovanBreadcrumb {
  name: string;
  path: string;
}

/**
 * Schema.org `Organization` for the site's owner, from the `siteSettings` singleton: name, address, logo, contact
 * details and social profiles (`sameAs`). Null without an organisation or site name.
 */
export function novanOrganizationJsonLd(settings: NovanSiteSettings | null | undefined, baseUrl: string): NovanJsonLd | null {
  const name = text(settings?.organisationName) ?? text(settings?.siteName);
  if (!settings || !name) return null;
  const url = `${baseUrl.replace(/\/+$/, '')}/`;
  const logo = settings.logo && httpUrl(settings.logo.url);
  const email = text(settings.contact?.email);
  const telephone = text(settings.contact?.phone);
  const address = text(settings.contact?.address);
  const sameAs = (settings.socialLinks ?? []).flatMap((link) => (link && httpUrl(link.url) ? [link.url as string] : []));
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name,
    url,
    ...(logo ? { logo } : {}),
    ...(email ? { email } : {}),
    ...(telephone ? { telephone } : {}),
    ...(address ? { address: { '@type': 'PostalAddress', streetAddress: address } } : {}),
    ...(sameAs.length ? { sameAs } : {}),
  };
}

/**
 * The trail to a page: the home page, then each folder above it, then the page. Folders are named from their slug
 * (`our-team` is "Our team") unless `names` gives a name for their path, e.g. the title of the page at that path. A
 * page whose address starts with its locale (`/fr/about`) starts from that locale's home page (`/fr`).
 */
export function novanBreadcrumbTrail(
  page: Pick<Page, 'path' | 'data' | 'alternates'>,
  options: { homeName?: string; names?: Readonly<Record<string, string>> } = {},
): NovanBreadcrumb[] {
  const prefix = localePrefix(page);
  const home = { name: options.homeName ?? 'Home', path: prefix || '/' };
  if (page.path === home.path) return [home];
  const segments = page.path.slice(prefix.length).split('/').filter(Boolean);
  const steps = segments.map((segment, index) => {
    const path = `${prefix}/${segments.slice(0, index + 1).join('/')}`;
    const last = index === segments.length - 1;
    const name = (last ? text(page.data.title) : null) ?? text(options.names?.[path]) ?? humanise(segment);
    return { name, path };
  });
  return [home, ...steps];
}

/**
 * The locale prefix of a page's address (`/fr` for `/fr/about`), from its alternates: the first is in the site's
 * default locale, which has none. Empty when there is none, or it cannot be told.
 */
function localePrefix(page: Pick<Page, 'path' | 'alternates'>): string {
  const plain = page.alternates?.[0]?.path;
  if (!plain || plain === page.path) return '';
  if (plain === '/') return /^\/[a-z0-9-]+$/.test(page.path) ? page.path : '';
  return page.path.endsWith(plain) && /^\/[a-z0-9-]+$/.test(page.path.slice(0, -plain.length)) ? page.path.slice(0, -plain.length) : '';
}

/** Schema.org `BreadcrumbList` for a trail from {@link novanBreadcrumbTrail}. Null for the home page alone. */
export function novanBreadcrumbJsonLd(trail: readonly NovanBreadcrumb[], baseUrl: string): NovanJsonLd | null {
  if (trail.length < 2) return null;
  const base = baseUrl.replace(/\/+$/, '');
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((step, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: step.name,
      item: `${base}${step.path}`,
    })),
  };
}

/**
 * Writes `data` into the head as `<script type="application/ld+json" id="novan-ld-<key>">`, replacing the one with
 * the same key; null removes it. On the server it is part of the HTML search engines read.
 */
export function applyNovanJsonLd(key: string, data: NovanJsonLd | null, options: { injector?: Injector } = {}): void {
  const document = (options.injector ?? inject(Injector)).get(DOCUMENT);
  const id = `novan-ld-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  let script = document.getElementById(id);
  if (!data) {
    script?.remove();
    return;
  }
  if (!script) {
    script = document.createElement('script');
    script.setAttribute('type', 'application/ld+json');
    script.id = id;
    document.head.appendChild(script);
  }
  // `<` escaped, so text in the data cannot close the script element.
  script.textContent = JSON.stringify(data).replace(/</g, '\\u003c');
}

function humanise(slug: string): string {
  const words = slug.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function httpUrl(value: unknown): string | null {
  return typeof value === 'string' && /^https?:\/\/[^/\\]/i.test(value) ? value : null;
}
