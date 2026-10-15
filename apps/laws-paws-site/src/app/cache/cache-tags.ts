import { HttpErrorResponse, type HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { inject, RESPONSE_INIT } from '@angular/core';
import { tap } from 'rxjs';

/** Cloudflare reads at most 16 KB of `Cache-Tag`; the API keeps to 15 KB too. */
export const MAX_CACHE_TAG_LENGTH = 15_000;

/**
 * Collects the `Cache-Tag`s of every Delivery API answer a server render uses (the page, navigation, site
 * settings...) on the page's own response, so publishing one of them purges the page from the CDN. When an
 * answer fails, the page is marked `no-store`: it may be missing content, and a failed answer has no tags to
 * purge it by. In the browser (no `RESPONSE_INIT`) it does nothing. `server.ts` turns the tags into the
 * page's caching headers.
 */
export const cacheTagInterceptor: HttpInterceptorFn = (req, next) => {
  const init = inject(RESPONSE_INIT, { optional: true });
  if (!init) return next(req);
  return next(req).pipe(
    tap({
      next: (event) => {
        const tags = event instanceof HttpResponse ? event.headers.get('Cache-Tag') : null;
        if (tags) setHeader(init, 'Cache-Tag', mergeCacheTags(new Headers(init.headers).get('Cache-Tag'), tags));
      },
      error: (error: unknown) => {
        if (error instanceof HttpErrorResponse) setHeader(init, 'Cache-Control', 'no-store');
      },
    }),
  );
};

/**
 * Two `Cache-Tag` values as one, without repeats. If the result is too long for the CDN it keeps the first
 * tags that fit plus `overflow:<space>` for each space, which the API purges on every change in the space.
 */
export function mergeCacheTags(existing: string | null, added: string | null): string {
  const tags = [...new Set([...split(existing), ...split(added)])];
  const full = tags.join(',');
  if (full.length <= MAX_CACHE_TAG_LENGTH) return full;

  const kept = [...new Set(tags.filter((tag) => tag.startsWith('space:')).map((tag) => `overflow:${tag.slice('space:'.length)}`))];
  let length = kept.join(',').length;
  for (const tag of tags) {
    if (kept.includes(tag)) continue;
    if (length + tag.length + 1 > MAX_CACHE_TAG_LENGTH) break;
    kept.push(tag);
    length += tag.length + 1;
  }
  return kept.join(',');
}

function split(value: string | null): string[] {
  return (value ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function setHeader(init: ResponseInit, name: string, value: string): void {
  const headers = new Headers(init.headers);
  headers.set(name, value);
  init.headers = headers;
}
