import type { NovanLinkValue } from './types';

/**
 * Link addresses the SDK renders: web, mail and phone links, site paths and anchors. Never `javascript:`,
 * `data:` or `//host` (nor `/\host`, which browsers read as `//host`). Matches what the editor accepts.
 */
const SAFE_HREF = /^(https?:\/\/|mailto:|tel:|\/(?![/\\])|#)/i;
/** Image sources the SDK renders: web addresses and site paths. */
const SAFE_SRC = /^(https?:\/\/|\/(?![/\\]))/i;

export function isSafeHref(href: unknown): href is string {
  return typeof href === 'string' && SAFE_HREF.test(href);
}

export function isSafeImageSrc(src: unknown): src is string {
  return typeof src === 'string' && SAFE_SRC.test(src);
}

/** A link to render: a site path (for the router) or an address to open as it is. */
export type NovanResolvedLink =
  | { internal: true; href: string; path: string; queryParams: Record<string, string>; fragment: string | undefined }
  | { internal: false; href: string };

/** Splits a safe address into what `routerLink` needs, or returns null for an unsafe one. */
export function resolveHref(href: unknown): NovanResolvedLink | null {
  if (!isSafeHref(href)) return null;
  if (!href.startsWith('/') && !href.startsWith('#')) return { internal: false, href };
  const hash = href.indexOf('#');
  const fragment = hash >= 0 ? href.slice(hash + 1) || undefined : undefined;
  const beforeHash = hash >= 0 ? href.slice(0, hash) : href;
  const query = beforeHash.indexOf('?');
  const path = query >= 0 ? beforeHash.slice(0, query) : beforeHash;
  const queryParams: Record<string, string> = {};
  if (query >= 0) new URLSearchParams(beforeHash.slice(query + 1)).forEach((value, key) => (queryParams[key] = value));
  // `#top` stays on the current page.
  if (!path) return { internal: false, href };
  return { internal: true, href, path, queryParams, fragment };
}

/**
 * The address of a `link` field: the page's path for internal links (null when the page is not published),
 * the URL of external links, `mailto:` for email links. Null for anything unsafe or malformed.
 */
export function novanLinkHref(link: NovanLinkValue | null | undefined): string | null {
  if (!link || typeof link !== 'object') return null;
  switch (link.type) {
    case 'internal': {
      if (typeof link.path !== 'string') return null;
      const href = link.anchor ? `${link.path}#${link.anchor}` : link.path;
      return isSafeHref(href) ? href : null;
    }
    case 'external':
      return isSafeHref(link.url) && /^https?:/i.test(link.url) ? link.url : null;
    case 'email':
      return typeof link.email === 'string' && /^[^\s@]+@[^\s@]+$/.test(link.email) ? `mailto:${link.email}` : null;
    default:
      return null;
  }
}
