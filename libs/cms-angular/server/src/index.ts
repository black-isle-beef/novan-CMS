// `@black-isle-beef/cms-angular/server`: runs in the site's Node server (`server.ts`), never in the browser.
import type { NovanPreviewSession, NovanServerOptions } from '@black-isle-beef/cms-angular';

/** The parts of a Node `IncomingMessage` (or Express request) the proxy reads. */
export interface NovanProxyRequest {
  method?: string;
  /** Relative to where the proxy is mounted, e.g. `/delivery/pages?path=/about`. */
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}

/** The parts of a Node `ServerResponse` (or Express response) the proxy writes. */
export interface NovanProxyResponse {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  end(body?: Uint8Array): unknown;
}

export interface NovanProxyOptions extends NovanServerOptions {
  /** Replaced in tests. */
  fetch?: typeof fetch;
}

export type NovanProxyHandler = (req: NovanProxyRequest, res: NovanProxyResponse, next?: (error?: unknown) => void) => Promise<void>;

/** The read routes of the Delivery and Preview APIs, and nothing else. */
const ROUTE = /^\/(delivery|preview)\/(pages|entries|entries\/[0-9a-fA-F-]{36}|singletons\/[a-z][a-zA-Z0-9]{0,63}|sitemap)$/;
const PREVIEW_HEADER = 'x-novan-preview';
/** Upstream headers passed back to the browser. */
const PASSED_HEADERS = ['content-type', 'etag', 'cache-control', 'cache-tag'];

/**
 * Lets the browser read content through the site's own server, which adds the API token: mount it where
 * `provideNovanCms({ proxyPath })` points (default `/_novan`), e.g. `app.use('/_novan', createNovanProxy(options))`.
 *
 * Only GET and HEAD of the Delivery and Preview read routes pass. Preview requests need the admin's signed
 * token in `X-Novan-Preview`, accepted by `verifyPreview`; their answers are never cached.
 */
export function createNovanProxy(options: NovanProxyOptions): NovanProxyHandler {
  const fetchFn = options.fetch ?? fetch;
  const apiUrl = options.apiUrl.replace(/\/+$/, '');

  return async (req, res, next) => {
    const url = req.url ?? '';
    const query = url.indexOf('?');
    const path = query >= 0 ? url.slice(0, query) : url;
    const route = url.length <= 4096 ? ROUTE.exec(path) : null;
    if (!route) {
      if (next) next();
      else problem(res, 404, 'not_found', 'There is nothing here.');
      return;
    }
    const method = (req.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      problem(res, 405, 'method_not_allowed', 'Only GET and HEAD are allowed.');
      return;
    }

    const scope = route[1] as 'delivery' | 'preview';
    const headers: Record<string, string> = { Accept: 'application/json' };
    const ifNoneMatch = header(req, 'if-none-match');
    if (ifNoneMatch) headers['If-None-Match'] = ifNoneMatch;

    if (scope === 'preview') {
      const signed = header(req, PREVIEW_HEADER);
      if (!signed || !options.previewToken || !(await allowed(options, signed))) {
        problem(res, 403, 'preview_not_allowed', 'This preview link is not valid. Open the preview again from the admin.');
        return;
      }
      headers['Authorization'] = `Bearer ${options.previewToken}`;
      headers['X-Novan-Preview'] = signed;
    } else {
      headers['Authorization'] = `Bearer ${options.deliveryToken}`;
    }

    try {
      const upstream = await fetchFn(`${apiUrl}/v1${url}`, { method, headers, redirect: 'manual' });
      res.statusCode = upstream.status;
      for (const name of PASSED_HEADERS) {
        const value = upstream.headers.get(name);
        if (value !== null) res.setHeader(name, value);
      }
      if (scope === 'preview') res.setHeader('Cache-Control', 'private, no-store');
      res.end(method === 'HEAD' ? undefined : new Uint8Array(await upstream.arrayBuffer()));
    } catch (error) {
      if (next) next(error);
      else problem(res, 502, 'api_unreachable', 'The content API could not be reached.');
    }
  };
}

async function allowed(options: NovanServerOptions, signed: string): Promise<boolean> {
  if (!options.verifyPreview) return false;
  try {
    const verdict = await options.verifyPreview(signed);
    return verdict === true || (typeof verdict === 'object' && verdict !== null);
  } catch {
    return false;
  }
}

export interface NovanPreviewVerifierOptions {
  /** The Novan API as the site's server reaches it. */
  apiUrl: string;
  /** The site's preview token (`nv_pre_...`). Without one, every signed token is refused. */
  previewToken: string | undefined;
  /** Replaced in tests. */
  fetch?: typeof fetch;
}

/** How long an accepted signed token is trusted before the API is asked again (never past its expiry). */
const ACCEPTED_FOR_MS = 60_000;
/** How long a refused one is remembered, so a bad link cannot make the server call the API on every request. */
const REFUSED_FOR_MS = 10_000;
const MAX_REMEMBERED = 1000;

/**
 * The `verifyPreview` for `NovanServerOptions`: asks the Preview API (`GET /v1/preview/session`) whether the
 * admin's signed token is valid for this site's space, and answers with the session, or `false`. Answers are
 * kept briefly, so a page and the content requests it makes ask the API once. It fails closed: when the API
 * cannot be reached, preview is refused.
 */
export function createNovanPreviewVerifier(options: NovanPreviewVerifierOptions): (signedToken: string) => Promise<NovanPreviewSession | false> {
  const fetchFn = options.fetch ?? fetch;
  const url = `${options.apiUrl.replace(/\/+$/, '')}/v1/preview/session`;
  const remembered = new Map<string, { session: NovanPreviewSession | false; until: number }>();

  const remember = (signed: string, session: NovanPreviewSession | false, until: number) => {
    if (remembered.size >= MAX_REMEMBERED) {
      const now = Date.now();
      for (const [key, entry] of remembered) if (entry.until <= now) remembered.delete(key);
      if (remembered.size >= MAX_REMEMBERED) remembered.clear();
    }
    remembered.set(signed, { session, until });
  };

  return async (signed) => {
    if (!options.previewToken || !signed || signed.length > 4096) return false;
    const now = Date.now();
    const known = remembered.get(signed);
    if (known && known.until > now) return known.session;

    let response: Response;
    try {
      response = await fetchFn(url, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${options.previewToken}`, [PREVIEW_HEADER]: signed },
        redirect: 'manual',
      });
    } catch {
      return false;
    }
    if (response.status === 403) {
      remember(signed, false, now + REFUSED_FOR_MS);
      return false;
    }
    const session = response.ok ? toSession(await response.json().catch(() => null)) : null;
    if (!session) return false;
    remember(signed, session, Math.min(now + ACCEPTED_FOR_MS, Date.parse(session.expiresAt)));
    return session;
  };
}

function toSession(body: unknown): NovanPreviewSession | null {
  if (typeof body !== 'object' || body === null) return null;
  const { entryId, expiresAt, adminOrigin } = body as Record<string, unknown>;
  if (typeof entryId !== 'string' || typeof expiresAt !== 'string' || typeof adminOrigin !== 'string') return null;
  return Number.isNaN(Date.parse(expiresAt)) ? null : { entryId, expiresAt, adminOrigin };
}

function header(req: NovanProxyRequest, name: string): string | null {
  const value = req.headers[name];
  const first = Array.isArray(value) ? value[0] : value;
  return first && first.length <= 4096 ? first : null;
}

function problem(res: NovanProxyResponse, status: number, code: string, detail: string): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/problem+json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(new TextEncoder().encode(JSON.stringify({ type: 'about:blank', title: detail, status, code, detail })));
}
