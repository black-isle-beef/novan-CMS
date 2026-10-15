import { inject, RESPONSE_INIT } from '@angular/core';
import { type ResolveFn, RedirectCommand } from '@angular/router';
import { type NovanBlockNode, NovanContentService, novanPageResolver, type Page } from '@black-isle-beef/cms-angular';
import { catchError, from, isObservable, map, type Observable, of, switchMap } from 'rxjs';

/** The `notFound` singleton (supabase/seed.sql): what an address with no page shows. */
export interface NotFoundData {
  title?: string;
  body?: NovanBlockNode[] | null;
}

/** What the catch-all route shows. */
export type CmsPageState =
  | { status: 'found'; page: Page }
  | { status: 'not-found'; notFound: NotFoundData | null }
  | { status: 'error' };

/**
 * The page at the route's address, through the SDK's `novanPageResolver` (which answers 404 when there is
 * none). A missing page brings the `notFound` singleton, or null for the built-in message. When the API
 * fails the server answers 503, so the CDN does not keep the error and the next request tries again.
 */
export const cmsPageResolver: ResolveFn<CmsPageState> = (route, state) => {
  const content = inject(NovanContentService);
  const response = inject(RESPONSE_INIT, { optional: true });
  const resolved = novanPageResolver(route, state);
  const page$: Observable<unknown> = isObservable(resolved) ? resolved : from(Promise.resolve(resolved));

  return page$.pipe(
    switchMap((page): Observable<CmsPageState> => {
      if (page && !(page instanceof RedirectCommand)) return of({ status: 'found', page: page as Page });
      return content.singleton<NotFoundData>('notFound').pipe(
        map((notFound): CmsPageState => ({ status: 'not-found', notFound })),
        catchError(() => of<CmsPageState>({ status: 'not-found', notFound: null })),
      );
    }),
    catchError(() => {
      if (response) response.status = 503;
      return of<CmsPageState>({ status: 'error' });
    }),
  );
};
