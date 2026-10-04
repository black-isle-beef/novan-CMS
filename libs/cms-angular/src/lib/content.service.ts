import { isPlatformServer } from '@angular/common';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { inject, Injectable, Injector, makeStateKey, PLATFORM_ID, TransferState } from '@angular/core';
import { pendingUntilEvent } from '@angular/core/rxjs-interop';
import { catchError, from, map, type Observable, of, switchMap, tap, throwError } from 'rxjs';
import { DEFAULT_PROXY_PATH, NOVAN_CMS_CONFIG, NOVAN_CMS_SERVER } from './config';
import { NovanPreview } from './preview';
import type { NovanEntry, Page, PageData, Paged } from './types';

type Scalar = string | number | boolean;

/** `fields.<field>` filters: a value means `eq`; `in` matches one of a list. Needs `type`. */
export type NovanFieldFilter = Scalar | { eq?: Scalar; in?: readonly Scalar[]; lt?: Scalar; gt?: Scalar };

export interface NovanEntriesQuery {
  /** Content type api id; needed to filter or sort by fields. */
  type?: string;
  locale?: string;
  /** `updatedAt`, `path` or `fields.<field>`; a leading `-` for descending. Default `-updatedAt`. */
  sort?: string;
  /** 1 to 100, default 25. */
  limit?: number;
  /** The `nextCursor` of the previous page. */
  cursor?: string;
  /** How deep to expand references, 0 to 3 (default 1). */
  include?: number;
  /** Only these fields of `data`. */
  select?: readonly string[];
  /** By field api id, e.g. `{ category: 'news', publishedOn: { gt: '2026-01-01' } }`. */
  filter?: Readonly<Record<string, NovanFieldFilter>>;
}

export interface NovanEntryOptions {
  locale?: string;
  include?: number;
  select?: readonly string[];
}

export interface NovanSitemap {
  items: { path: string; locale: string; updatedAt: string }[];
}

/** An error answer from the Novan API (RFC 9457 problem details, with the API's stable `code`). */
export class NovanApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = 'NovanApiError';
  }
}

type Scope = 'delivery' | 'preview';
interface Settled<T> {
  body: T | null;
}

/** Header carrying the admin's signed preview token to the proxy and the Preview API. */
export const PREVIEW_HEADER = 'X-Novan-Preview';

/**
 * Reads content from the Novan Delivery API, or the Preview API in preview mode.
 *
 * On the server it calls the API with the token from `provideNovanCmsServer` and stores each answer in the
 * page's transfer state; the browser takes those answers instead of fetching again. Later requests from
 * the browser go through the site's own server (`createNovanProxy`), so tokens never reach the browser.
 */
@Injectable({ providedIn: 'root' })
export class NovanContentService {
  private readonly http = inject(HttpClient);
  private readonly injector = inject(Injector);
  private readonly config = inject(NOVAN_CMS_CONFIG);
  private readonly preview = inject(NovanPreview);
  private readonly transferState = inject(TransferState);
  private readonly server = isPlatformServer(inject(PLATFORM_ID));

  /** The page at a path (`/` is the home page), or null when there is none. */
  page<T = PageData>(path: string, options: NovanEntryOptions = {}): Observable<Page<T> | null> {
    return this.get<Page<T>>('pages', { path, ...this.entryParams(options) }, true);
  }

  /** Entries, filtered, sorted and a page at a time. */
  entries<T = Record<string, unknown>>(query: NovanEntriesQuery = {}): Observable<Paged<T>> {
    const params: Record<string, string> = {
      ...this.entryParams({ locale: query.locale, include: query.include, select: query.select }),
    };
    if (query.type) params['type'] = query.type;
    if (query.sort) params['sort'] = query.sort;
    if (query.limit !== undefined) params['limit'] = String(query.limit);
    if (query.cursor) params['cursor'] = query.cursor;
    for (const [field, filter] of Object.entries(query.filter ?? {})) {
      if (typeof filter !== 'object') {
        params[`fields.${field}[eq]`] = String(filter);
        continue;
      }
      for (const op of ['eq', 'lt', 'gt'] as const) {
        const value = filter[op];
        if (value !== undefined) params[`fields.${field}[${op}]`] = String(value);
      }
      if (filter.in) params[`fields.${field}[in]`] = filter.in.map(String).join(',');
    }
    return this.get<Paged<T>>('entries', params, false).pipe(map((page) => page as Paged<T>));
  }

  /** One entry by id, or null when there is none. */
  entry<T = Record<string, unknown>>(id: string, options: Omit<NovanEntryOptions, 'locale'> = {}): Observable<NovanEntry<T> | null> {
    // An entry has one locale already; the API refuses `locale` here.
    const params = this.entryParams(options);
    delete params['locale'];
    return this.get<NovanEntry<T>>(`entries/${encodeURIComponent(id)}`, params, true);
  }

  /** A singleton's content, e.g. site settings or navigation. */
  singleton<T = Record<string, unknown>>(apiId: string, options: NovanEntryOptions = {}): Observable<T> {
    return this.get<NovanEntry<T>>(`singletons/${encodeURIComponent(apiId)}`, this.entryParams(options), false).pipe(
      map((entry) => (entry as NovanEntry<T>).data),
    );
  }

  /** Every page's path and when it last changed, for sitemap.xml. */
  sitemap(options: { locale?: string } = {}): Observable<NovanSitemap> {
    const locale = options.locale ?? this.config.locale;
    return this.get<NovanSitemap>('sitemap', locale ? { locale } : {}, false).pipe(map((sitemap) => sitemap as NovanSitemap));
  }

  private entryParams(options: NovanEntryOptions): Record<string, string> {
    const params: Record<string, string> = {};
    const locale = options.locale ?? this.config.locale;
    if (locale) params['locale'] = locale;
    if (options.include !== undefined) params['include'] = String(options.include);
    if (options.select?.length) params['select'] = options.select.map((field) => `fields.${field}`).join(',');
    return params;
  }

  private get<T>(endpoint: string, params: Record<string, string>, nullWhenMissing: boolean): Observable<T | null> {
    return from(this.preview.resolve()).pipe(
      switchMap((previewing) => {
        const scope: Scope = previewing ? 'preview' : 'delivery';
        const key = makeStateKey<Settled<T>>(`novan:${scope}:${endpoint}?${new URLSearchParams(sorted(params))}`);
        if (!this.server && this.transferState.hasKey(key)) {
          const settled = this.transferState.get(key, { body: null });
          this.transferState.remove(key);
          return of(settled.body);
        }
        const { url, headers } = this.target(scope, endpoint);
        return this.http
          .get<T>(url, {
            params,
            headers,
            // These answers travel in our own transfer state, keyed by what was asked rather than by URL.
            transferCache: false,
            ...(scope === 'preview' ? { cache: 'no-store' as const } : {}),
          })
          .pipe(
            map((body): Settled<T> => ({ body })),
            catchError((error: unknown) =>
              nullWhenMissing && error instanceof HttpErrorResponse && error.status === 404
                ? of<Settled<T>>({ body: null })
                : throwError(() => toApiError(error)),
            ),
            tap((settled) => {
              if (this.server) this.transferState.set(key, settled);
            }),
            map((settled) => settled.body),
          );
      }),
      pendingUntilEvent(this.injector),
    );
  }

  /** Where to send a request, and the headers it needs. */
  private target(scope: Scope, endpoint: string): { url: string; headers: HttpHeaders } {
    let headers = new HttpHeaders({ Accept: 'application/json' });
    if (scope === 'preview' && this.preview.signedToken) headers = headers.set(PREVIEW_HEADER, this.preview.signedToken);

    const server = this.server ? this.injector.get(NOVAN_CMS_SERVER, null) : null;
    if (server) {
      const token = scope === 'preview' ? server.previewToken : server.deliveryToken;
      if (!token) throw new Error(`Novan CMS: provideNovanCmsServer needs a ${scope} token.`);
      return { url: `${trimSlash(server.apiUrl)}/v1/${scope}/${endpoint}`, headers: headers.set('Authorization', `Bearer ${token}`) };
    }
    if (scope === 'delivery' && this.config.publicDeliveryToken && this.config.apiUrl) {
      return {
        url: `${trimSlash(this.config.apiUrl)}/v1/delivery/${endpoint}`,
        headers: headers.set('Authorization', `Bearer ${this.config.publicDeliveryToken}`),
      };
    }
    if (this.server) {
      throw new Error('Novan CMS: add provideNovanCmsServer(...) to the server config, or a publicDeliveryToken.');
    }
    return { url: `${trimSlash(this.config.proxyPath ?? DEFAULT_PROXY_PATH)}/${scope}/${endpoint}`, headers };
  }
}

function sorted(params: Record<string, string>): [string, string][] {
  return Object.entries(params).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function toApiError(error: unknown): unknown {
  if (!(error instanceof HttpErrorResponse)) return error;
  const problem = (typeof error.error === 'object' && error.error !== null ? error.error : {}) as Record<string, unknown>;
  const code = typeof problem['code'] === 'string' ? problem['code'] : null;
  const detail = typeof problem['detail'] === 'string' ? problem['detail'] : error.message;
  return new NovanApiError(error.status, code, detail);
}
