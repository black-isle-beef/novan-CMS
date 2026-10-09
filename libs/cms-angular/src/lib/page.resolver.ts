import { inject, RESPONSE_INIT } from '@angular/core';
import type { ResolveFn } from '@angular/router';
import { type Observable, of, switchMap, tap } from 'rxjs';
import { NovanContentService } from './content.service';
import { novanResolveLocale } from './locale';
import type { Page } from './types';

/** A page address the Delivery API can hold: `/` or lowercase slugs, e.g. `/blog/hello-world`. */
const PAGE_PATH = /^\/$|^(\/[a-z0-9]+(-[a-z0-9]+)*)+$/;

/**
 * Route resolver for CMS pages, usually on a catch-all route: loads the page at the route's address, in its locale
 * (`/fr/about` is the French `/about` when the site shows the locale in addresses). When there is none it resolves
 * to `null` and the server answers 404, so the route's component shows a "page not found" message.
 *
 * ```ts
 * { path: '**', component: CmsPage, resolve: { page: novanPageResolver } }
 * ```
 */
export const novanPageResolver: ResolveFn<Page | null> = (_route, state): Observable<Page | null> => {
  const response = inject(RESPONSE_INIT, { optional: true });
  const content = inject(NovanContentService);
  const markNotFound = () => {
    if (response) response.status = 404;
  };
  return novanResolveLocale(state.url).pipe(
    switchMap(({ locale, path: address }) => {
      const path = novanPagePath(address);
      if (!path) {
        markNotFound();
        return of(null);
      }
      return content.page(path, locale ? { locale } : {});
    }),
    tap((page) => {
      if (!page) markNotFound();
    }),
  );
};

/** The CMS path of a router URL (`/about/?x=1#top` → `/about`), or null if no page can have it (`/About`). */
export function novanPagePath(url: string): string | null {
  let path = url.split(/[?#]/, 1)[0] ?? '';
  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }
  path = path.length > 1 ? path.replace(/\/+$/, '') : path;
  if (!path) path = '/';
  return path.length <= 1000 && PAGE_PATH.test(path) ? path : null;
}
