// Redirects and not-found reports for the site's Node server (docs/build/14-seo-site-features.md).
import type { NovanRedirect, NovanServerOptions } from '@black-isle-beef/cms-angular';
import type { NovanProxyRequest } from './index';

/** The parts of an Express (or Node) response a redirect writes. */
export interface NovanRedirectResponse {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  end(body?: Uint8Array): unknown;
}

export interface NovanRedirectsOptions extends Pick<NovanServerOptions, 'apiUrl' | 'deliveryToken'> {
  /**
   * How long the list of redirects is reused before the API is asked again, in milliseconds (default 5000). A new
   * or changed redirect, or a page whose address changed, works within this time.
   */
  maxAgeMs?: number;
  /** `Cache-Control` for a redirect the API's list was cached under (default: kept by a CDN until a purge). */
  cacheControl?: string;
  /** Replaced in tests. */
  fetch?: typeof fetch;
}

/** Where a request is redirected, with the CDN tags of the list it came from. */
export interface NovanRedirectMatch {
  location: string;
  status: 301 | 302;
  /** The Delivery API's `Cache-Tag`s, so the CDN can keep the redirect until one changes. */
  cacheTags: string | null;
}

export interface NovanRedirectHandler {
  /** The redirect for a request's path and query, or null. */
  match(url: string): Promise<NovanRedirectMatch | null>;
  /**
   * Express-style middleware: answers GET and HEAD requests that have a redirect, and passes everything else on.
   * Mount it before the Angular handler, so old addresses never render.
   */
  handle(req: NovanProxyRequest, res: NovanRedirectResponse, next: (error?: unknown) => void): Promise<void>;
}

const CDN_CACHE_CONTROL = 'public, s-maxage=31536000, stale-while-revalidate=60';

/**
 * Applies the space's redirects (`GET /v1/delivery/redirects`) on the site's server, before rendering. The list is
 * kept in memory for `maxAgeMs`; when the API cannot be reached the last list is used, and without one requests
 * pass on and render as usual. A path matches with or without a trailing slash; a redirect without a query of its
 * own keeps the request's (`?utm_source=...`).
 */
export function createNovanRedirects(options: NovanRedirectsOptions): NovanRedirectHandler {
  const fetchFn = options.fetch ?? fetch;
  const url = `${options.apiUrl.replace(/\/+$/, '')}/v1/delivery/redirects`;
  const maxAge = options.maxAgeMs ?? 5000;
  let list: { byPath: Map<string, NovanRedirect>; tags: string | null; until: number } | null = null;
  let loading: Promise<void> | null = null;

  const load = async () => {
    try {
      const response = await fetchFn(url, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${options.deliveryToken}` },
        redirect: 'manual',
      });
      if (!response.ok) throw new Error(`The Delivery API answered ${response.status}.`);
      const body = (await response.json()) as { items?: unknown };
      const byPath = new Map<string, NovanRedirect>();
      for (const item of Array.isArray(body.items) ? body.items : []) {
        if (isRedirect(item)) byPath.set(key(item.from), item);
      }
      list = { byPath, tags: response.headers.get('cache-tag'), until: Date.now() + maxAge };
    } catch {
      // Keep the last list for a while longer rather than asking again on every request.
      if (list) list.until = Date.now() + maxAge;
    }
  };

  const current = async () => {
    if (!list || list.until <= Date.now()) {
      loading ??= load().finally(() => (loading = null));
      await loading;
    }
    return list;
  };

  const match = async (requestUrl: string): Promise<NovanRedirectMatch | null> => {
    const query = requestUrl.indexOf('?');
    const path = (query >= 0 ? requestUrl.slice(0, query) : requestUrl).split('#', 1)[0];
    if (!path.startsWith('/') || path.length > 4096) return null;
    const redirects = await current();
    const redirect = redirects?.byPath.get(key(path));
    if (!redirect) return null;
    const search = query >= 0 ? requestUrl.slice(query).split('#', 1)[0] : '';
    const location = search && !redirect.to.includes('?') ? insertQuery(redirect.to, search) : redirect.to;
    return { location, status: redirect.status, cacheTags: redirects?.tags ?? null };
  };

  return {
    match,
    handle: async (req, res, next) => {
      const method = (req.method ?? 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') return next();
      let found: NovanRedirectMatch | null;
      try {
        found = await match(req.url ?? '/');
      } catch (error) {
        return next(error);
      }
      if (!found) return next();
      res.statusCode = found.status;
      res.setHeader('Location', found.location);
      if (found.cacheTags) {
        res.setHeader('Cache-Control', options.cacheControl ?? CDN_CACHE_CONTROL);
        res.setHeader('Cache-Tag', found.cacheTags);
      } else {
        res.setHeader('Cache-Control', 'no-store');
      }
      res.end();
    },
  };
}

export interface NovanNotFoundReporterOptions extends Pick<NovanServerOptions, 'apiUrl' | 'deliveryToken'> {
  /** Replaced in tests. */
  fetch?: typeof fetch;
}

/**
 * Tells the CMS an address had no page (`POST /v1/delivery/not-found`), so editors see it among the top 404s and
 * can redirect it. Never throws, and does not wait for the API: call it after answering 404, as the response is
 * sent. Referrers other than http(s) URLs are left out.
 */
export function createNovanNotFoundReporter(options: NovanNotFoundReporterOptions): (path: string, referrer?: string | null) => Promise<void> {
  const fetchFn = options.fetch ?? fetch;
  const url = `${options.apiUrl.replace(/\/+$/, '')}/v1/delivery/not-found`;
  return async (path, referrer) => {
    if (!path.startsWith('/') || path.length > 4096) return;
    try {
      await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.deliveryToken}` },
        body: JSON.stringify({ path, referrer: referrer && /^https?:\/\//i.test(referrer) ? referrer.slice(0, 2048) : null }),
        redirect: 'manual',
      });
    } catch {
      // A report is not worth failing anything for.
    }
  };
}

function isRedirect(value: unknown): value is NovanRedirect {
  if (typeof value !== 'object' || value === null) return false;
  const { from, to, status } = value as Record<string, unknown>;
  return typeof from === 'string' && from.startsWith('/') && typeof to === 'string' && (status === 301 || status === 302);
}

/** Paths are compared decoded and without a trailing slash, so `/caf%C3%A9/` finds a redirect from `/café`. */
function key(path: string): string {
  let decoded = path;
  try {
    decoded = decodeURI(path);
  } catch {
    // Malformed escapes: compare as sent.
  }
  return decoded.replace(/\/+$/, '') || '/';
}

/** `to` with the request's query string, before any fragment. */
function insertQuery(to: string, search: string): string {
  const hash = to.indexOf('#');
  return hash >= 0 ? `${to.slice(0, hash)}${search}${to.slice(hash)}` : `${to}${search}`;
}
