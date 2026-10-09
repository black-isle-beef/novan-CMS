import { DOCUMENT, inject, Injector } from '@angular/core';
import { catchError, map, type Observable, of, shareReplay, tap } from 'rxjs';
import { NOVAN_CMS_CONFIG } from './config';
import { NovanContentService } from './content.service';
import { NovanLocale } from './locale-state';
import type { NovanLocales } from './types';

export { NovanLocale };

/** An address on the site, read as a locale and the page's path. */
export interface NovanLocalePath {
  /** The locale the address is in; null when the site's locales are not known. */
  locale: string | null;
  /** The page's path without a locale prefix, e.g. `/about`. */
  path: string;
}

/**
 * The locale and page path of an address. When the site shows the locale in addresses, `/fr/about` is the French
 * `/about` and `/fr` the French home page; every other address is in the default locale.
 */
export function novanLocaleOfPath(locales: NovanLocales, path: string): NovanLocalePath {
  const defaultLocale = locales.locales.find((locale) => locale.isDefault)?.code ?? null;
  if (!locales.prefixes) return { locale: defaultLocale, path };
  const [, first = ''] = path.split('/');
  const found = locales.locales.find((locale) => !locale.isDefault && locale.prefix === first);
  if (!found) return { locale: defaultLocale, path };
  return { locale: found.code, path: path.slice(first.length + 1) || '/' };
}

/**
 * Reads a router URL's locale, for route resolvers, and makes it {@link NovanLocale.current}. With `locale` in
 * `provideNovanCms` the site is in that locale only and the API is not asked. When the site's locales cannot be read,
 * the address is taken as it is, in the default locale.
 */
export function novanResolveLocale(url: string, injector: Injector = inject(Injector)): Observable<NovanLocalePath> {
  const config = injector.get(NOVAN_CMS_CONFIG);
  const state = injector.get(NovanLocale);
  const path = url.split(/[?#]/, 1)[0] || '/';
  if (config.locale) {
    state.current.set(config.locale);
    return of({ locale: config.locale, path });
  }
  // The layout's and the page's resolvers both ask: share one request.
  state.locales ??= injector.get(NovanContentService).locales().pipe(shareReplay(1));
  return state.locales.pipe(
      map((locales) => novanLocaleOfPath(locales, path)),
      catchError(() => {
        // Ask again next time rather than keep the failure.
        state.locales = null;
        return of<NovanLocalePath>({ locale: null, path });
      }),
      tap((resolved) => state.current.set(resolved.locale)),
    );
}

/** Sets the page's language on `<html lang>`, for screen readers, translation tools and search engines. */
export function applyNovanLang(locale: string | null | undefined, options: { injector?: Injector } = {}): void {
  const document = (options.injector ?? inject(Injector)).get(DOCUMENT);
  if (locale) document.documentElement.setAttribute('lang', locale);
}
